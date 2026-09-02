[CmdletBinding(PositionalBinding = $false)]
param(
    [Parameter(Position = 0)]
    [ValidateSet('Claude', 'Codex')]
    [string]$Agent,

    [ValidateSet('Done', 'Question', 'Code', 'Tested', 'Blocked')]
    [string]$State = 'Done',

    [switch]$ReadStdin,

    [switch]$CacheClaudeQuota,

    [string]$QuotaText = '',

    [switch]$PrintQuota,

    [switch]$Display,

    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$HookPayload
)

$ErrorActionPreference = 'Stop'

if (-not $Display -and -not $CacheClaudeQuota -and -not $PrintQuota -and (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'disabled'))) {
    exit 0
}

function Format-QuotaText {
    param($Primary, $Secondary)

    $parts = @()
    $now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    foreach ($limit in @($Primary, $Secondary)) {
        if ($null -eq $limit -or $null -eq $limit.usedPercent) { continue }

        $remaining = [Math]::Max(0, [Math]::Round(100 - [double]$limit.usedPercent))
        $minutes = [int]$limit.windowDurationMins
        $window = if ($minutes -eq 300) {
            '5 h'
        } elseif ($minutes -eq 10080) {
            '7 j'
        } elseif ($minutes -ge 1440 -and $minutes % 1440 -eq 0) {
            '{0} j' -f ($minutes / 1440)
        } elseif ($minutes -ge 60 -and $minutes % 60 -eq 0) {
            '{0} h' -f ($minutes / 60)
        } else {
            '{0} min' -f $minutes
        }

        $resetSuffix = ''
        if ($null -ne $limit.resetsAt -and [long]$limit.resetsAt -gt $now) {
            $seconds = [long]$limit.resetsAt - $now
            $days = [Math]::Floor($seconds / 86400)
            $hours = [Math]::Floor(($seconds % 86400) / 3600)
            $mins = [Math]::Floor(($seconds % 3600) / 60)
            $resetIn = if ($days -gt 0) {
                if ($hours -gt 0) { '{0} j {1} h' -f $days, $hours } else { '{0} j' -f $days }
            } elseif ($hours -gt 0) {
                if ($mins -gt 0) { '{0} h {1} min' -f $hours, $mins } else { '{0} h' -f $hours }
            } else {
                '{0} min' -f [Math]::Max(1, $mins)
            }
            $resetSuffix = ' reset {0}' -f $resetIn
        }

        $parts += '{0} {1} %{2}' -f $window, $remaining, $resetSuffix
    }

    if ($parts.Count -eq 0) { return '' }
    return 'Restant : ' + ($parts -join '  |  ')
}

function Wait-AppServerResponse {
    param(
        [System.Diagnostics.Process]$Process,
        [int]$Id,
        [int]$TimeoutMilliseconds
    )

    $watch = [System.Diagnostics.Stopwatch]::StartNew()
    while ($watch.ElapsedMilliseconds -lt $TimeoutMilliseconds) {
        $remaining = [Math]::Max(1, $TimeoutMilliseconds - [int]$watch.ElapsedMilliseconds)
        $readTask = $Process.StandardOutput.ReadLineAsync()
        if (-not $readTask.Wait($remaining)) { return $null }

        $line = $readTask.Result
        if ($null -eq $line) { return $null }
        try { $message = $line | ConvertFrom-Json } catch { continue }
        if ($message.id -eq $Id) { return $message }
    }
    return $null
}

function Get-CodexQuotaText {
    $codexCommand = Get-Command codex.exe -ErrorAction SilentlyContinue | Select-Object -First 1
    $codexPath = if ($codexCommand) { $codexCommand.Source } else { $null }

    if (-not $codexPath) {
        $codexPath = Get-ChildItem -Path (Join-Path $env:USERPROFILE '.vscode\extensions\openai.chatgpt-*\bin\windows-x86_64\codex.exe') -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime -Descending |
            Select-Object -First 1 -ExpandProperty FullName
    }
    if (-not $codexPath) { return '' }

    $process = $null
    try {
        $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
        $startInfo.FileName = $codexPath
        $startInfo.Arguments = 'app-server'
        $startInfo.UseShellExecute = $false
        $startInfo.CreateNoWindow = $true
        $startInfo.RedirectStandardInput = $true
        $startInfo.RedirectStandardOutput = $true
        $startInfo.RedirectStandardError = $true

        $process = [System.Diagnostics.Process]::new()
        $process.StartInfo = $startInfo
        $null = $process.Start()

        $process.StandardInput.WriteLine('{"method":"initialize","id":0,"params":{"clientInfo":{"name":"vsignal","title":"VSignal","version":"1.0.0"}}}')
        $process.StandardInput.Flush()
        $initialized = Wait-AppServerResponse -Process $process -Id 0 -TimeoutMilliseconds 3000
        if ($null -eq $initialized -or $initialized.error) { return '' }

        $process.StandardInput.WriteLine('{"method":"initialized","params":{}}')
        $process.StandardInput.WriteLine('{"method":"account/rateLimits/read","id":6}')
        $process.StandardInput.Flush()
        $response = Wait-AppServerResponse -Process $process -Id 6 -TimeoutMilliseconds 4000
        if ($null -eq $response -or $response.error -or $null -eq $response.result.rateLimits) { return '' }

        return Format-QuotaText -Primary $response.result.rateLimits.primary -Secondary $response.result.rateLimits.secondary
    } catch {
        return ''
    } finally {
        if ($null -ne $process) {
            try { $process.StandardInput.Close() } catch {}
            try { if (-not $process.HasExited) { $process.Kill() } } catch {}
            $process.Dispose()
        }
    }
}

function Get-ClaudeQuotaText {
    $cachePath = Join-Path $PSScriptRoot 'claude-quota.json'
    if (-not (Test-Path -LiteralPath $cachePath)) { return '' }

    try {
        $cache = Get-Content -Raw -LiteralPath $cachePath | ConvertFrom-Json
        $now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
        $primary = if ($null -ne $cache.fiveHourUsed -and [long]$cache.fiveHourResetsAt -gt $now) {
            [pscustomobject]@{ usedPercent = $cache.fiveHourUsed; windowDurationMins = 300; resetsAt = $cache.fiveHourResetsAt }
        } else { $null }
        $secondary = if ($null -ne $cache.sevenDayUsed -and [long]$cache.sevenDayResetsAt -gt $now) {
            [pscustomobject]@{ usedPercent = $cache.sevenDayUsed; windowDurationMins = 10080; resetsAt = $cache.sevenDayResetsAt }
        } else { $null }
        return Format-QuotaText -Primary $primary -Secondary $secondary
    } catch {
        return ''
    }
}

if ($CacheClaudeQuota) {
    try {
        $statusData = [Console]::In.ReadToEnd() | ConvertFrom-Json
        $rateLimits = if ($null -ne $statusData.rate_limits) {
            $statusData.rate_limits
        } elseif ($null -ne $statusData.rate_limit_info.unifiedWindows) {
            $statusData.rate_limit_info.unifiedWindows
        } else {
            $null
        }

        if ($null -ne $rateLimits) {
            $fiveHourUsed = if ($null -ne $rateLimits.five_hour.used_percentage) {
                [double]$rateLimits.five_hour.used_percentage
            } elseif ($null -ne $rateLimits.five_hour.utilization) {
                100 * [double]$rateLimits.five_hour.utilization
            } else { $null }
            $sevenDayUsed = if ($null -ne $rateLimits.seven_day.used_percentage) {
                [double]$rateLimits.seven_day.used_percentage
            } elseif ($null -ne $rateLimits.seven_day.utilization) {
                100 * [double]$rateLimits.seven_day.utilization
            } else { $null }
            [ordered]@{
                fiveHourUsed = $fiveHourUsed
                fiveHourResetsAt = if ($null -ne $rateLimits.five_hour.resets_at) { $rateLimits.five_hour.resets_at } else { $rateLimits.five_hour.resetsAt }
                sevenDayUsed = $sevenDayUsed
                sevenDayResetsAt = if ($null -ne $rateLimits.seven_day.resets_at) { $rateLimits.seven_day.resets_at } else { $rateLimits.seven_day.resetsAt }
            } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'claude-quota.json') -Encoding UTF8
        }
    } catch {}
    exit 0
}

if ($PrintQuota) {
    $value = if ($Agent -eq 'Codex') { Get-CodexQuotaText } else { Get-ClaudeQuotaText }
    if ($value) { [Console]::Out.WriteLine($value) }
    exit 0
}

# Return immediately to the agent hook, then show the popup in its own process.
if (-not $Display) {
    $rawPayload = ''
    if ($ReadStdin) {
        $rawPayload = [Console]::In.ReadToEnd()
    } elseif ($HookPayload.Count -gt 0) {
        $rawPayload = $HookPayload[-1]
    }

    if ($State -eq 'Done' -and $rawPayload) {
        try {
            $data = $rawPayload | ConvertFrom-Json
            $lastMessage = if ($data.'last-assistant-message') {
                [string]$data.'last-assistant-message'
            } elseif ($data.last_assistant_message) {
                [string]$data.last_assistant_message
            } else {
                ''
            }

            $tail = if ($lastMessage.Length -gt 600) {
                $lastMessage.Substring($lastMessage.Length - 600)
            } else {
                $lastMessage
            }

            if ($tail -match '(?is)\?\s*$|\b(would you|do you want|need you to|peux.tu|pouvez.vous|souhaites.tu)\b') {
                $State = 'Question'
            } elseif ($tail -match '(?i)\b(blocked|bloqu|need your input|besoin de toi|besoin de ton|besoin de ta|besoin de votre)') {
                $State = 'Blocked'
            } elseif ($lastMessage -match '(?i)\b(tests? (pass|passed|succeed|successful)|tests? valid|build (pass|passed|successful)|tout est valid)') {
                $State = 'Tested'
            } elseif ($lastMessage -match '(?i)\b(implement|modifi|ajout|corrig|r.par|refactor|fixed|updated|created|cr..|cod|fichier|files?)') {
                $State = 'Code'
            }
        } catch {
            $State = 'Done'
        }
    }

    $QuotaText = if ($Agent -eq 'Codex') { Get-CodexQuotaText } else { Get-ClaudeQuotaText }

    $powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $arguments = '-NoProfile -NonInteractive -STA -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}" -Agent "{1}" -State "{2}"' -f $PSCommandPath, $Agent, $State
    if ($QuotaText) { $arguments += ' -QuotaText "{0}"' -f $QuotaText }
    $arguments += ' -Display'
    Start-Process -FilePath $powershell -ArgumentList $arguments -WindowStyle Hidden
    exit 0
}

Add-Type -AssemblyName PresentationFramework

$window = [System.Windows.Window]::new()
$window.SizeToContent = [System.Windows.SizeToContent]::WidthAndHeight
$window.WindowStyle = [System.Windows.WindowStyle]::None
$window.ResizeMode = [System.Windows.ResizeMode]::NoResize
$window.ShowInTaskbar = $false
$window.ShowActivated = $false
$window.Topmost = $true
$window.AllowsTransparency = $true
$window.Background = [System.Windows.Media.Brushes]::Transparent
$window.WindowStartupLocation = [System.Windows.WindowStartupLocation]::Manual
$window.Opacity = 0

$background = if ($Agent -eq 'Claude') { '#E6C76545' } else { '#ED181A1E' }
$outline = if ($Agent -eq 'Claude') { '#80F1B89E' } else { '#705A5E64' }
$foreground = if ($Agent -eq 'Claude') { '#FFF8F3' } else { '#F2F0E8' }
$accent = if ($Agent -eq 'Claude') { '#FFF0E6' } else { '#42B978' }

$border = [System.Windows.Controls.Border]::new()
$border.Background = [System.Windows.Media.BrushConverter]::new().ConvertFromString($background)
$border.BorderBrush = [System.Windows.Media.BrushConverter]::new().ConvertFromString($outline)
$border.BorderThickness = [System.Windows.Thickness]::new(1)
$border.CornerRadius = [System.Windows.CornerRadius]::new(16)
$border.Padding = [System.Windows.Thickness]::new(24, 13, 24, 13)
$border.RenderTransformOrigin = [System.Windows.Point]::new(0.5, 0.5)

$scale = [System.Windows.Media.ScaleTransform]::new(0.92, 0.92)
$border.RenderTransform = $scale

$shadow = [System.Windows.Media.Effects.DropShadowEffect]::new()
$shadow.BlurRadius = 22
$shadow.ShadowDepth = 3
$shadow.Opacity = 0.28
$shadow.Color = [System.Windows.Media.Colors]::Black
$border.Effect = $shadow

$panel = [System.Windows.Controls.StackPanel]::new()
$panel.Orientation = [System.Windows.Controls.Orientation]::Horizontal
$panel.HorizontalAlignment = [System.Windows.HorizontalAlignment]::Center
$panel.VerticalAlignment = [System.Windows.VerticalAlignment]::Center

$contentPanel = [System.Windows.Controls.StackPanel]::new()
$contentPanel.Orientation = [System.Windows.Controls.Orientation]::Vertical
$contentPanel.HorizontalAlignment = [System.Windows.HorizontalAlignment]::Center

$dot = [System.Windows.Shapes.Ellipse]::new()
$dot.Width = 12
$dot.Height = 12
$dot.Margin = [System.Windows.Thickness]::new(0, 0, 13, 0)
$dot.Fill = [System.Windows.Media.BrushConverter]::new().ConvertFromString($accent)

$text = [System.Windows.Controls.TextBlock]::new()
$text.Text = switch ($State) {
    'Question' { '{0} attend ta r{1}ponse' -f $Agent, [char]0x00E9 }
    'Code' { '{0} a termin{1}' -f $Agent, [char]0x00E9 }
    'Tested' { '{0} a termin{1}, tout est valid{1} ! {2}' -f $Agent, [char]0x00E9, [char]0x2728 }
    'Blocked' { '{0} a besoin de toi' -f $Agent }
    default { '{0} a fini, c''est pr{1}t ! {2}' -f $Agent, [char]0x00EA, [char]0x2728 }
}
$text.Foreground = [System.Windows.Media.BrushConverter]::new().ConvertFromString($foreground)
$text.FontFamily = [System.Windows.Media.FontFamily]::new('Segoe UI')
$text.FontSize = 20
$text.FontWeight = [System.Windows.FontWeights]::SemiBold
$text.VerticalAlignment = [System.Windows.VerticalAlignment]::Center

$null = $panel.Children.Add($dot)
$null = $panel.Children.Add($text)
$null = $contentPanel.Children.Add($panel)

$quotaFills = @()
if ($QuotaText) {
    $quotaPanel = [System.Windows.Controls.StackPanel]::new()
    $quotaPanel.Margin = [System.Windows.Thickness]::new(0, 7, 0, 0)
    $quotaPanel.HorizontalAlignment = [System.Windows.HorizontalAlignment]::Center

    $quotaTitle = [System.Windows.Controls.TextBlock]::new()
    $quotaTitle.Text = 'Quota restant'
    $quotaTitle.Foreground = [System.Windows.Media.BrushConverter]::new().ConvertFromString($foreground)
    $quotaTitle.FontFamily = [System.Windows.Media.FontFamily]::new('Segoe UI')
    $quotaTitle.FontSize = 11
    $quotaTitle.Opacity = 0.68
    $quotaTitle.Margin = [System.Windows.Thickness]::new(0, 0, 0, 3)
    $quotaTitle.HorizontalAlignment = [System.Windows.HorizontalAlignment]::Center
    $null = $quotaPanel.Children.Add($quotaTitle)

    $matches = [regex]::Matches($QuotaText, '(\d+\s*(?:min|h|j))\s+(\d+)\s*%(?:\s+reset\s+([^|]+))?')
    foreach ($match in $matches) {
        $label = $match.Groups[1].Value
        $percent = [Math]::Min(100, [Math]::Max(0, [int]$match.Groups[2].Value))
        $resetIn = $match.Groups[3].Value.Trim()

        $row = [System.Windows.Controls.StackPanel]::new()
        $row.Orientation = [System.Windows.Controls.Orientation]::Horizontal
        $row.Margin = [System.Windows.Thickness]::new(0, 2, 0, 1)
        $row.VerticalAlignment = [System.Windows.VerticalAlignment]::Center

        $labelText = [System.Windows.Controls.TextBlock]::new()
        $labelText.Text = $label
        $labelText.Width = 34
        $labelText.Foreground = [System.Windows.Media.BrushConverter]::new().ConvertFromString($foreground)
        $labelText.FontFamily = [System.Windows.Media.FontFamily]::new('Segoe UI')
        $labelText.FontSize = 11
        $labelText.Opacity = 0.78
        $labelText.VerticalAlignment = [System.Windows.VerticalAlignment]::Center

        $track = [System.Windows.Controls.Border]::new()
        $track.Width = 150
        $track.Height = 7
        $track.Margin = [System.Windows.Thickness]::new(5, 0, 8, 0)
        $track.Background = [System.Windows.Media.BrushConverter]::new().ConvertFromString('#38FFFFFF')
        $track.CornerRadius = [System.Windows.CornerRadius]::new(4)

        $fill = [System.Windows.Controls.Border]::new()
        $fill.Width = 0
        $fill.Height = 7
        $fill.HorizontalAlignment = [System.Windows.HorizontalAlignment]::Left
        $barColor = if ($percent -lt 20) {
            '#E85D5D'
        } elseif ($percent -le 40) {
            '#F0A44B'
        } else {
            $accent
        }
        $fill.Background = [System.Windows.Media.BrushConverter]::new().ConvertFromString($barColor)
        $fill.CornerRadius = [System.Windows.CornerRadius]::new(4)
        $track.Child = $fill

        $percentText = [System.Windows.Controls.TextBlock]::new()
        $percentText.Text = '{0} %' -f $percent
        $percentText.Width = 38
        $percentText.TextAlignment = [System.Windows.TextAlignment]::Right
        $percentText.Foreground = [System.Windows.Media.BrushConverter]::new().ConvertFromString($foreground)
        $percentText.FontFamily = [System.Windows.Media.FontFamily]::new('Segoe UI')
        $percentText.FontSize = 11
        $percentText.Opacity = 0.82
        $percentText.VerticalAlignment = [System.Windows.VerticalAlignment]::Center

        $resetText = [System.Windows.Controls.TextBlock]::new()
        $resetText.Text = if ($resetIn) { 'reset dans {0}' -f $resetIn } else { '' }
        $resetText.Width = 100
        $resetText.Margin = [System.Windows.Thickness]::new(10, 0, 0, 0)
        $resetText.Foreground = [System.Windows.Media.BrushConverter]::new().ConvertFromString($foreground)
        $resetText.FontFamily = [System.Windows.Media.FontFamily]::new('Segoe UI')
        $resetText.FontSize = 10
        $resetText.Opacity = 0.62
        $resetText.VerticalAlignment = [System.Windows.VerticalAlignment]::Center

        $null = $row.Children.Add($labelText)
        $null = $row.Children.Add($track)
        $null = $row.Children.Add($percentText)
        $null = $row.Children.Add($resetText)
        $null = $quotaPanel.Children.Add($row)
        $quotaFills += [pscustomobject]@{ Fill = $fill; Target = 1.5 * $percent }
    }

    $null = $contentPanel.Children.Add($quotaPanel)
}

$border.Child = $contentPanel
$window.Content = $border

$ease = [System.Windows.Media.Animation.CubicEase]::new()
$ease.EasingMode = [System.Windows.Media.Animation.EasingMode]::EaseOut

$fadeIn = [System.Windows.Media.Animation.DoubleAnimation]::new()
$fadeIn.From = 0
$fadeIn.To = 0.96
$fadeIn.Duration = [System.Windows.Duration]::new([TimeSpan]::FromMilliseconds(280))
$fadeIn.EasingFunction = $ease

$grow = [System.Windows.Media.Animation.DoubleAnimation]::new()
$grow.From = 0.92
$grow.To = 1
$grow.Duration = [System.Windows.Duration]::new([TimeSpan]::FromMilliseconds(320))
$grow.EasingFunction = $ease

$pulse = [System.Windows.Media.Animation.DoubleAnimation]::new()
$pulse.From = 0.45
$pulse.To = 1
$pulse.Duration = [System.Windows.Duration]::new([TimeSpan]::FromMilliseconds(750))
$pulse.AutoReverse = $true
$pulse.RepeatBehavior = [System.Windows.Media.Animation.RepeatBehavior]::Forever

$timer = [System.Windows.Threading.DispatcherTimer]::new()
$timer.Interval = [TimeSpan]::FromSeconds(4.5)
$timer.Add_Tick({
    $timer.Stop()

    $fadeOut = [System.Windows.Media.Animation.DoubleAnimation]::new()
    $fadeOut.From = $window.Opacity
    $fadeOut.To = 0
    $fadeOut.Duration = [System.Windows.Duration]::new([TimeSpan]::FromMilliseconds(450))
    $fadeOut.Add_Completed({ $window.Close() })
    $window.BeginAnimation([System.Windows.Window]::OpacityProperty, $fadeOut)
})
$window.Add_ContentRendered({
    $workArea = [System.Windows.SystemParameters]::WorkArea
    $window.Left = $workArea.Left + (($workArea.Width - $window.ActualWidth) / 2)
    $window.Top = $workArea.Bottom - $window.ActualHeight - 70

    $window.BeginAnimation([System.Windows.Window]::OpacityProperty, $fadeIn)
    $scale.BeginAnimation([System.Windows.Media.ScaleTransform]::ScaleXProperty, $grow)
    $scale.BeginAnimation([System.Windows.Media.ScaleTransform]::ScaleYProperty, $grow)
    $dot.BeginAnimation([System.Windows.UIElement]::OpacityProperty, $pulse)
    foreach ($entry in $quotaFills) {
        $barAnimation = [System.Windows.Media.Animation.DoubleAnimation]::new()
        $barAnimation.From = 0
        $barAnimation.To = $entry.Target
        $barAnimation.Duration = [System.Windows.Duration]::new([TimeSpan]::FromMilliseconds(550))
        $barAnimation.EasingFunction = $ease
        $entry.Fill.BeginAnimation([System.Windows.FrameworkElement]::WidthProperty, $barAnimation)
    }
    $timer.Start()
})

$null = $window.ShowDialog()
