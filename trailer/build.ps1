# ── Adversary trailer build ───────────────────────────────────────────────
# Run from the trailer/ directory. Requires ffmpeg on PATH.
$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

New-Item -ItemType Directory -Force -Path clips | Out-Null

# clip: name, segment, startFrame, duration(s), frames(cnt)
$clips = @(
  @{ name="open"; seg="seg4"; s=1;  dur=2.0; cnt=40  },
  @{ name="a";    seg="seg1"; s=10; dur=4.0; cnt=120 },
  @{ name="b";    seg="seg3"; s=20; dur=3.6; cnt=155 },
  @{ name="c";    seg="seg2"; s=5;  dur=3.0; cnt=150 },
  @{ name="d";    seg="seg4"; s=45; dur=2.6; cnt=56  },
  @{ name="e";    seg="seg5"; s=1;  dur=4.2; cnt=163 },
  @{ name="f";    seg="seg2"; s=1;  dur=4.6; cnt=159 }
)

$vfBase = "crop=1001:563:0:0,scale=1920:1080:flags=lanczos,hqdn3d=3:2:6:5,setsar=1,fps=30"

foreach ($c in $clips) {
  $F = [math]::Round($c.cnt / $c.dur, 3)
  $vf = "$vfBase,format=yuv420p"
  if ($c.name -eq "open") { $vf = "$vfBase,fade=t=in:st=0:d=0.8,format=yuv420p" }
  Write-Output ">> clip $($c.name)  seg=$($c.seg) start=$($c.s) N=$($c.cnt) fps=$F dur=$($c.dur)"
  ffmpeg -y -hide_banner -loglevel error `
    -start_number $c.s -framerate $F -i "frames/$($c.seg)/f_%05d.jpg" `
    -t $c.dur -vf $vf -an -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p `
    "clips/$($c.name).mp4"
}

# ── End card (5s) ─────────────────────────────────────────────────────────
Write-Output ">> end card"
$endVf = @(
  "drawtext=fontfile=impact.ttf:text='ADVERSARY':fontcolor=white:fontsize=180:x=(w-text_w)/2:y=(h-text_h)/2-80:alpha='if(lt(t,0.4),0,if(lt(t,1.2),(t-0.4)/0.8,1))'",
  "drawtext=fontfile=arialbd.ttf:text='OUTTALK THE MACHINES':fontcolor=0xE6E6E6:fontsize=56:x=(w-text_w)/2:y=(h/2)+80:alpha='if(lt(t,0.9),0,if(lt(t,1.7),(t-0.9)/0.8,1))'",
  "drawtext=fontfile=arialbd.ttf:text='AI vs AI      TAKE A SEAT':fontcolor=0x9AA0FF:fontsize=34:x=(w-text_w)/2:y=(h/2)+175:alpha='if(lt(t,1.6),0,if(lt(t,2.2),(t-1.6)/0.6,1))'",
  "fade=t=in:st=0:d=0.5",
  "fade=t=out:st=4.3:d=0.7",
  "format=yuv420p"
) -join ","
ffmpeg -y -hide_banner -loglevel error -f lavfi -i "color=c=0x050508:s=1920x1080:d=5:r=30" `
  -vf $endVf -an -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p "clips/end.mp4"

# ── Concat (all clips share codec/params) ─────────────────────────────────
Write-Output ">> concat"
$order = @("open","a","b","c","d","e","f","end")
$list = ($order | ForEach-Object { "file 'clips/$_.mp4'" }) -join "`n"
Set-Content -Path "concat.txt" -Value $list -Encoding ascii
ffmpeg -y -hide_banner -loglevel error -f concat -safe 0 -i concat.txt -c copy "clips/video.mp4"

# ── Audio master ──────────────────────────────────────────────────────────
Write-Output ">> audio mix"
$filter = @(
  "[0]volume=0.30,afade=t=in:st=0:d=1.8,afade=t=out:st=27:d=2[m]",
  "[1]adelay=2300|2300,volume=1.8[v1]",
  "[2]adelay=6200|6200,volume=1.8[v2]",
  "[3]adelay=9800|9800,volume=1.8[v3]",
  "[4]adelay=15700|15700,volume=1.8[v4]",
  "[5]adelay=19500|19500,volume=1.8[v5]",
  "[6]adelay=24600|24600,volume=1.8[v6]",
  "[7]adelay=12600|12600,volume=0.85[sn]",
  "[8]adelay=16900|16900,volume=0.9[sd]",
  "[9]adelay=19400|19400,volume=0.8[sr]",
  "[10]adelay=24000|24000,volume=0.9[sw]",
  "[m][v1][v2][v3][v4][v5][v6][sn][sd][sr][sw]amix=inputs=11:duration=longest:normalize=0[mx]",
  "[mx]alimiter=limit=0.95,aformat=sample_rates=44100:channel_layouts=stereo[a]"
) -join ";"
ffmpeg -y -hide_banner -loglevel error `
  -i audio/bed.mp3 -i audio/vo1.mp3 -i audio/vo2.mp3 -i audio/vo3.mp3 `
  -i audio/vo4.mp3 -i audio/vo5.mp3 -i audio/vo6.mp3 `
  -i audio/sfx_night.mp3 -i audio/sfx_death.mp3 -i audio/sfx_reveal.mp3 -i audio/sfx_win.mp3 `
  -filter_complex $filter -map "[a]" -t 29 -c:a aac -b:a 192k "audio.m4a"

# ── Final: burn subtitles + mux ───────────────────────────────────────────
Write-Output ">> final mux + subtitles"
ffmpeg -y -hide_banner -loglevel error -i "clips/video.mp4" -i "audio.m4a" `
  -vf "subtitles=subs.ass" -map 0:v -map 1:a `
  -c:v libx264 -preset slow -crf 22 -pix_fmt yuv420p `
  -c:a aac -b:a 160k -shortest -movflags +faststart "adversary-trailer.mp4"

Write-Output "DONE -> trailer/adversary-trailer.mp4"
