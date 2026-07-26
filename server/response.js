export async function readLimitedBytes(response, maximumBytes) {
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
    throw new RangeError("Response body exceeds the configured limit.");
  }
  if (!response.body || typeof response.body.getReader !== "function") {
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > maximumBytes) throw new RangeError("Response body exceeds the configured limit.");
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      total += chunk.length;
      if (total > maximumBytes) {
        await reader.cancel();
        throw new RangeError("Response body exceeds the configured limit.");
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

export async function readLimitedText(response, maximumBytes) {
  return (await readLimitedBytes(response, maximumBytes)).toString("utf8");
}
