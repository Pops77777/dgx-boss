param(
    [int]$Port = 8080,
    [switch]$NoBrowser
)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$candidatePorts = @(8080, 8085, 8090, 8099, 9000, 7860)
$listener = $null
foreach ($p in $candidatePorts) {
    try {
        $l = New-Object System.Net.HttpListener
        $l.Prefixes.Add("http://localhost:$p/")
        $l.Start()
        $Port = $p
        $prefix = "http://localhost:$p/"
        $listener = $l
        break
    } catch {}
}

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  DGx Unlimited - Ultra VIP AI Workspace" -ForegroundColor Green
Write-Host "  Web UI : $prefix" -ForegroundColor Yellow
Write-Host "  API URL: ${prefix}v1/chat/completions" -ForegroundColor Magenta
Write-Host "  Auth   : Bearer dgx-..." -ForegroundColor Green
Write-Host "  Press Ctrl+C in this console to stop" -ForegroundColor Gray
Write-Host "==========================================" -ForegroundColor Cyan

if (-not $NoBrowser) {
    Start-Process $prefix -ErrorAction SilentlyContinue
}

$htmlPath = Join-Path $PSScriptRoot "index.html"

# Forward request using raw bytes to prevent UTF-8 emoji corruption
function Forward-WorkerRequest([byte[]]$requestBytes) {
    $tempIn = [System.IO.Path]::GetTempFileName()
    $tempOut = [System.IO.Path]::GetTempFileName()
    [System.IO.File]::WriteAllBytes($tempIn, $requestBytes)

    curl.exe -s -X POST "https://allaitools-generate.freemodels.workers.dev/api/chat" `
        -H "Content-Type: application/json" `
        -H "Origin: https://rusherai.com" `
        -H "Referer: https://rusherai.com/" `
        --data-binary "@$tempIn" `
        -o "$tempOut"

    $outBytes = [System.IO.File]::ReadAllBytes($tempOut)

    Remove-Item $tempIn -Force -ErrorAction SilentlyContinue
    Remove-Item $tempOut -Force -ErrorAction SilentlyContinue
    return $outBytes
}

function Read-RequestBody($request) {
    $len = [int]$request.ContentLength64
    if ($len -le 0) { return @() }
    $buffer = New-Object byte[] $len
    $totalRead = 0
    while ($totalRead -lt $len) {
        $read = $request.InputStream.Read($buffer, $totalRead, $len - $totalRead)
        if ($read -le 0) { break }
        $totalRead += $read
    }
    return $buffer
}

while ($listener.IsListening) {
    $context = $null
    try {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response

        $response.Headers.Add("Access-Control-Allow-Origin", "*")
        $response.Headers.Add("Access-Control-Allow-Headers", "Content-Type, Authorization")
        $response.Headers.Add("Access-Control-Allow-Methods", "GET, POST, OPTIONS, HEAD")

        if ($request.HttpMethod -eq "OPTIONS") {
            $response.StatusCode = 204
            $response.Close()
            continue
        }

        $urlPath = $request.Url.AbsolutePath

        # Serve Web UI
        if ($urlPath -eq "/" -or $urlPath -eq "/index.html") {
            $response.ContentType = "text/html; charset=utf-8"
            $bytes = [System.IO.File]::ReadAllBytes($htmlPath)
            $response.ContentLength64 = $bytes.Length
            if ($request.HttpMethod -ne "HEAD") {
                $response.OutputStream.Write($bytes, 0, $bytes.Length)
            }
            $response.Close()
            continue
        }

        # Models List Endpoint
        if ($urlPath -eq "/v1/models" -and $request.HttpMethod -eq "GET") {
            $models = @(
                "gpt-6-astra", "claude-opus-5.5", "claude-sonnet-5",
                "sol", "terra", "claude-fable-5.1", "glm-5.2", "kimi-k3", "dgx-image-flux"
            )
            $modelList = @{
                object = "list"
                data = @($models | ForEach-Object { @{ id = $_; object = "model"; owned_by = "dgx-unlimited" } })
            }
            $json = ConvertTo-Json $modelList -Compress
            $response.ContentType = "application/json; charset=utf-8"
            $outBytes = [System.Text.Encoding]::UTF8.GetBytes($json)
            $response.ContentLength64 = $outBytes.Length
            $response.OutputStream.Write($outBytes, 0, $outBytes.Length)
            $response.Close()
            continue
        }

        # OpenAI Image Generation Endpoint /v1/images/generations
        if ($urlPath -eq "/v1/images/generations" -and $request.HttpMethod -eq "POST") {
            $rawBytes = Read-RequestBody $request
            $jsonStr = [System.Text.Encoding]::UTF8.GetString($rawBytes)
            $parsed = $jsonStr | ConvertFrom-Json
            $promptText = if ($parsed.prompt) { $parsed.prompt } else { "a beautiful futuristic city" }
            $seed = Get-Random -Minimum 1000 -Maximum 999999
            $encodedPrompt = [System.Uri]::EscapeDataString($promptText)
            $imgUrl = "https://image.pollinations.ai/prompt/${encodedPrompt}?model=turbo&width=1024&height=1024&nologo=true&seed=${seed}"
            $imgResp = @{
                created = [int][DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
                data = @(@{ url = $imgUrl })
            }
            $finalJson = ConvertTo-Json $imgResp -Depth 5 -Compress
            $response.ContentType = "application/json; charset=utf-8"
            $outBytes = [System.Text.Encoding]::UTF8.GetBytes($finalJson)
            $response.ContentLength64 = $outBytes.Length
            $response.OutputStream.Write($outBytes, 0, $outBytes.Length)
            $response.Close()
            continue
        }

        # Standard OpenAI /v1/chat/completions Endpoint
        if ($urlPath -eq "/v1/chat/completions" -and $request.HttpMethod -eq "POST") {
            $rawBytes = Read-RequestBody $request
            if ($rawBytes.Length -gt 0) {
                $jsonStr = [System.Text.Encoding]::UTF8.GetString($rawBytes)
                $parsed = $jsonStr | ConvertFrom-Json

                # Model selection: 1. Body param, 2. DGx API Key name, 3. Default
                $modelName = $parsed.model
                if (-not $modelName) {
                    $authHeader = $request.Headers["Authorization"]
                    if ($authHeader -match "Bearer\s+(?:dgx|sk-rusher)-([a-zA-Z0-9\.\-_]+)-") {
                        $modelName = $matches[1]
                    } else {
                        $modelName = "gpt-6-astra"
                    }
                }

                $payloadObj = @{
                    messages = $parsed.messages
                    modelId = $modelName
                    thinking = [bool]$parsed.thinking
                    deepSearch = [bool]$parsed.deepSearch
                    stream = $false
                }
                $workerPayload = ConvertTo-Json $payloadObj -Depth 10 -Compress
                $workerBytes = [System.Text.Encoding]::UTF8.GetBytes($workerPayload)

                $workerOutBytes = Forward-WorkerRequest $workerBytes
                $workerJson = [System.Text.Encoding]::UTF8.GetString($workerOutBytes)
                $workerData = $workerJson | ConvertFrom-Json
                $content = if ($workerData.content) { $workerData.content } else { "" }

                $openaiResp = @{
                    id = "chatcmpl-dgx-" + [System.Guid]::NewGuid().ToString("N")
                    object = "chat.completion"
                    created = [int][DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
                    model = $modelName
                    choices = @(
                        @{
                            index = 0
                            message = @{ role = "assistant"; content = $content }
                            finish_reason = "stop"
                        }
                    )
                    usage = @{ prompt_tokens = 0; completion_tokens = 0; total_tokens = 0 }
                }
                $finalJson = ConvertTo-Json $openaiResp -Depth 10 -Compress
                $outBytes = [System.Text.Encoding]::UTF8.GetBytes($finalJson)
            } else {
                $outBytes = [System.Text.Encoding]::UTF8.GetBytes('{"error":{"message":"Empty request body"}}')
            }

            $response.ContentType = "application/json; charset=utf-8"
            $response.ContentLength64 = $outBytes.Length
            $response.OutputStream.Write($outBytes, 0, $outBytes.Length)
            $response.Close()
            continue
        }

        # Internal /api/chat Endpoint (used by index.html)
        if ($urlPath -eq "/api/chat" -and $request.HttpMethod -eq "POST") {
            $rawBytes = Read-RequestBody $request
            if ($rawBytes.Length -gt 0) {
                $outBytes = Forward-WorkerRequest $rawBytes
            } else {
                $outBytes = [System.Text.Encoding]::UTF8.GetBytes('{"error":"Empty request body"}')
            }

            $response.ContentType = "application/json; charset=utf-8"
            $response.ContentLength64 = $outBytes.Length
            $response.OutputStream.Write($outBytes, 0, $outBytes.Length)
            $response.Close()
            continue
        }

        $response.StatusCode = 404
        $msg = [System.Text.Encoding]::UTF8.GetBytes("Not Found")
        $response.OutputStream.Write($msg, 0, $msg.Length)
        $response.Close()

    } catch {
        if ($context -and $context.Response) {
            try { $context.Response.Close() } catch {}
        }
    }
}
