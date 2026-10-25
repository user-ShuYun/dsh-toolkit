# 批量生成氛围循环素材（LTX 快出 + ping-pong 无缝循环）
$ErrorActionPreference = 'Continue'
$node = 'D:\Node\node.exe'
$ff = 'D:\tools\ffmpeg\bin\ffmpeg.exe'
$outDir = 'D:\deepseek\out\loops'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$clips = @(
  @{ name = 'rain-neon';  prompt = 'Close up of rain falling into a puddle on wet concrete at night, neon pink and blue reflections rippling, droplets splashing, shallow depth of field, cinematic anime background, no people, static camera' },
  @{ name = 'cyber-alley'; prompt = 'A narrow cyberpunk alley at night, wet asphalt, glowing vertical neon signs in pink and cyan, steam rising from vents, puddle reflections, no people, static camera, cinematic anime background, detailed' },
  @{ name = 'fog-forest'; prompt = 'Morning fog drifting between tall trees in a forest, soft sunbeams through the canopy, moss and ferns, shallow depth of field, cinematic anime background, no people, static camera, peaceful' },
  @{ name = 'ocean-rock'; prompt = 'Slow motion ocean waves crashing on dark rocks at dusk, white foam spreading, sea spray in the air, deep blue and orange sky, cinematic anime background, no people, static camera' }
)

foreach ($c in $clips) {
  $raw = Join-Path $outDir ($c.name + '-raw.mp4')
  $loop = Join-Path $outDir ($c.name + '.mp4')
  Write-Host "=== $($c.name) ==="
  & $node 'D:\deepseek\tools\comfy.mjs' run --workflow 'D:\deepseek\out\workflows\ltx-t2v-api.json' --out $raw `
    --set '44.ckpt_name=ltxv-2b-0.9.8-distilled-fp8.safetensors' `
    --set '38.clip_name=t5xxl_fp8_e4m3fn.safetensors' `
    --set '71.steps=8' --set '72.cfg=1' `
    --set '70.width=640' --set '70.height=384' --set '70.length=73' `
    --set "6.text=$($c.prompt)" `
    --set '7.text=low quality, blurry, watermark, text, people, hands, camera shake, distorted' `
    --timeout 900
  if (Test-Path $raw) {
    & $ff -y -i $raw -filter_complex '[0:v]split[a][b];[b]reverse[r];[a][r]concat=n=2:v=1:a=0[v]' -map '[v]' -c:v libx264 -crf 18 -pix_fmt yuv420p $loop 2>&1 | Select-Object -Last 1
    Write-Host ("loop -> {0}  {1:N0} KB" -f $loop, ((Get-Item $loop).Length/1KB))
  }
}
Get-ChildItem $outDir -Filter *.mp4 | Select-Object Name,@{n='KB';e={[math]::Round($_.Length/1KB)}} | Format-Table -AutoSize
