/**
 * 把网关给的 `code_url` 变成一张可以直接塞进 `<img src>` 的二维码。
 *
 * 生成在**服务端**做，客户端拿到的是 data URL。三个理由：
 *
 * 1. `qrcode` 的浏览器构建要一块 canvas，而落地页是首个渲染面，不该为一张二维码
 *    拉一个画图依赖；
 * 2. 服务端生成意味着 `createOrder` 一次往返就带着图回来，前端没有"拿到链接再画"
 *    的第二帧——那一帧正是用户最容易看到空白方块的时候；
 * 3. SVG 而不是 PNG：`qrcode` 的 SVG 输出只含路径数据，二维码内容不会以文本形式
 *    出现在标记里，`data:` 编码后再进 `<img>` 就更没有解析面。
 */
import QRCode from "qrcode"

/** 二维码的渲染边长（px）。定价卡弹窗里 240 是"手机能扫、还留得下说明文字"的尺寸。 */
export const QR_SIZE = 240

export async function qrImageDataUrl(payload: string): Promise<string> {
  const svg = await QRCode.toString(payload, {
    type: "svg",
    margin: 1,
    width: QR_SIZE,
    errorCorrectionLevel: "M",
  })
  const encoded = Buffer.from(svg, "utf8").toString("base64")
  return `data:image/svg+xml;base64,${encoded}`
}
