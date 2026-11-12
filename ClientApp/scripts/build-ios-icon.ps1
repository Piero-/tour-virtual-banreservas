Add-Type -AssemblyName System.Drawing
$sourcePath = Join-Path $PSScriptRoot '../public/assets/pnglogo.png'
$outputPath = Join-Path $PSScriptRoot '../public/assets/apple-touch-icon-padded.png'
$source = [System.Drawing.Image]::FromFile((Resolve-Path $sourcePath))
$bitmap = [System.Drawing.Bitmap]::new(180, 180)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
try {
    $graphics.Clear([System.Drawing.ColorTranslator]::FromHtml('#f3ebd4'))
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    # Preserve the original logo inside a centered 72% safe area.
    $scale = 130.0 / [Math]::Max($source.Width, $source.Height)
    $width = [single]($source.Width * $scale)
    $height = [single]($source.Height * $scale)
    $graphics.DrawImage($source, [single]((180 - $width) / 2), [single]((180 - $height) / 2), $width, $height)
    $bitmap.Save([System.IO.Path]::GetFullPath($outputPath), [System.Drawing.Imaging.ImageFormat]::Png)
} finally {
    $graphics.Dispose()
    $bitmap.Dispose()
    $source.Dispose()
}
