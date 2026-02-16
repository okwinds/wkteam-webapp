/**
 * 读取 File 为 dataURL（base64）
 *
 * @param file 浏览器 File 对象
 * @returns dataURL 字符串
 */
export async function fileToDataUrl(file: File): Promise<string> {
  const reader = new FileReader()
  return await new Promise((resolve, reject) => {
    reader.onerror = () => reject(new Error('FileReader error'))
    reader.onload = () => resolve(String(reader.result))
    reader.readAsDataURL(file)
  })
}

