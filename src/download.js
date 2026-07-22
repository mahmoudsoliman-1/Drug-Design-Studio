// Central file-save helper.
// In a normal browser this triggers a download. Inside the packaged native
// window (pywebview / macOS WKWebView), browser downloads silently do nothing,
// so we route through a native Save dialog via the Python bridge (window.pywebview).

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onerror = () => reject(new Error('read failed'))
    r.onload = () => resolve(String(r.result).split(',')[1] || '')
    r.readAsDataURL(blob)
  })
}

export async function saveFile(filename, data, mime = 'application/octet-stream') {
  let blob
  if (data instanceof Blob) blob = data
  else if (typeof data === 'string' && data.startsWith('data:')) blob = await (await fetch(data)).blob()
  else blob = new Blob([data], { type: mime })

  const api = typeof window !== 'undefined' && window.pywebview && window.pywebview.api
  if (api && api.save_file) {
    // native app: hand the bytes to Python, which shows a Save dialog and writes the file
    const b64 = await blobToBase64(blob)
    await api.save_file(filename, b64)
    return
  }

  // browser: standard download
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1500)
}
