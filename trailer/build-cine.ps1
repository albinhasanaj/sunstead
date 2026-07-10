# ── Adversary CINEMATIC trailer build (hardcoded scene) ───────────────────
# Frames rendered deterministically to trailer/frames_cine by scene.html.
$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

# ── Video: frames -> graded 1080p30 ───────────────────────────────────────
Write-Output ">> grading video"
$grade = @(
  "eq=contrast=1.08:saturation=1.14:brightness=0.008",
  "rgbashift=rh=-2:bh=2",
  "noise=alls=7:allf=t",
  "format=yuv420p"
) -join ","
ffmpeg -y -hide_banner -loglevel error -framerate 30 -i "frames_cine/f_%05d.jpg" `
  -vf $grade -an -c:v libx264 -preset slow -crf 20 -pix_fmt yuv420p "clips/cine_video.mp4"

# ── Audio: cinematic bed + VO + SFX hits ──────────────────────────────────
Write-Output ">> audio mix"
# Arc: music builds -> climax IMPACT at 22.5 -> hard DUCK into a held-quiet ->
# the final VO line lands almost alone -> soft swell for the end card.
# All hits are low-passed (deep, not harsh) and mixed to support the VO.
$musicVol = "0.62*clip(t/2,0,1)*(0.82+0.18*clip((t-2)/19,0,1))*(1-0.92*(clip((t-22.7)/0.4,0,1)-clip((t-27.0)/0.5,0,1)))*(1-clip((t-29.5)/1.5,0,1))"
$filter = @(
  "[0]volume='$musicVol':eval=frame[m]",
  "[1]adelay=2300|2300,volume=1.95[v1]",
  "[2]adelay=6200|6200,volume=1.95[v2]",
  "[3]adelay=9800|9800,volume=1.95[v3]",
  "[4]adelay=14300|14300,volume=1.95[v4]",
  "[5]adelay=17200|17200,volume=1.95[v5]",
  "[6]adelay=21400|21400,volume=1.95[v6]",
  "[7]adelay=24650|24650,volume=2.15[v7]",
  "[8]lowpass=f=4000,afade=t=in:st=0:d=0.2,volume=0.5,adelay=17050|17050[riser]",
  "[9]lowpass=f=3600,afade=t=out:st=0.7:d=0.7,volume=0.6,adelay=22430|22430[impact]",
  "[10]lowpass=f=2200,afade=t=out:st=0.3:d=0.6,volume=0.33,adelay=22950|22950[subdrop]",
  "[11]lowpass=f=2600,afade=t=in:st=0:d=0.05,afade=t=out:st=1.3:d=1.1,volume=0.30,adelay=6150|6150[lyingboom]",
  "[12]lowpass=f=3200,afade=t=in:st=0:d=0.12,volume=0.52,adelay=27480|27480[swell]",
  "[13]lowpass=f=3000,afade=t=out:st=1.2:d=1.3,volume=0.44,adelay=27450|27450[logo]",
  "[m][v1][v2][v3][v4][v5][v6][v7][riser][impact][subdrop][lyingboom][swell][logo]amix=inputs=14:duration=longest:normalize=0[mx]",
  "[mx]alimiter=limit=0.96,apad,aformat=sample_rates=44100:channel_layouts=stereo[a]"
) -join ";"
ffmpeg -y -hide_banner -loglevel error `
  -i audio/cinematic.mp3 -i audio/vo1.mp3 -i audio/vo2.mp3 -i audio/vo3.mp3 `
  -i audio/vo4.mp3 -i audio/vo5.mp3 -i audio/vo6.mp3 -i audio/vo7.mp3 `
  -i audio/sfx_riser.mp3 -i audio/sfx_impact.mp3 -i audio/sfx_subdrop.mp3 `
  -i audio/sfx_night.mp3 -i audio/sfx_win.mp3 -i audio/sfx_impact.mp3 `
  -filter_complex $filter -map "[a]" -t 33.8 -c:a aac -b:a 192k "audio_cine.m4a"

# ── Mux ───────────────────────────────────────────────────────────────────
Write-Output ">> mux"
ffmpeg -y -hide_banner -loglevel error -i "clips/cine_video.mp4" -i "audio_cine.m4a" `
  -map 0:v -map 1:a -c:v copy -c:a aac -b:a 192k -shortest -movflags +faststart `
  "adversary-cinematic.mp4"

Write-Output "DONE -> trailer/adversary-cinematic.mp4"
