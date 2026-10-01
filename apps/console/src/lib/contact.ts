/**
 * 「联系团队」弹窗里的联系方式。
 *
 * 之前这一块是「预约企业演示 / 预约团队演示」两个入口：都要读者填表、排期、等回访，
 * 而这个站点的主张是信息全部免费公开。留一个能立刻加上的联系方式，比留一条要走
 * 三轮的对接流程更符合同一套说法。
 *
 * 二维码图片由运营直接覆盖 `public/images/contact-wechat.png`（微信号二维码导出成
 * PNG 即可），微信号写在这里：二维码扫不出来的时候还能复制文字，两处指向同一个号。
 * 换号只改这一个文件。
 */

export const CONTACT = {
  /** 微信号。弹窗里展示，剪贴板里复制的也是它。 */
  wechatId: "your-wx-id",
  /** 二维码图片路径，文件放在 `apps/console/public/images/` 下。 */
  qrSrc: "/images/contact-wechat.png",
} as const