const MAX_PROFILE_DIMENSION = 512;
const PROFILE_WEBP_QUALITIES = [0.82, 0.72, 0.62];

function canvasToWebp(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Could not compress this profile photo."));
    }, "image/webp", quality);
  });
}

export async function compressProfileImage(blob) {
  if (!blob || !/^image\/(jpeg|png|webp)$/.test(blob.type)) return blob;

  let bitmap;
  try {
    bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, MAX_PROFILE_DIMENSION / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && blob.type === "image/webp" && blob.size <= 300_000) return blob;

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) return blob;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    let compressed = blob;
    for (const quality of PROFILE_WEBP_QUALITIES) {
      compressed = await canvasToWebp(canvas, quality);
      if (compressed.size <= 300_000) break;
    }
    return compressed.size < blob.size ? compressed : blob;
  } catch {
    return blob;
  } finally {
    bitmap?.close?.();
  }
}
