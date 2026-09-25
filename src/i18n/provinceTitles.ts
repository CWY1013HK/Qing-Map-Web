import type { Locale } from './types'

/** Display titles for province SVG plates. Canonical Traditional stays in JSON. */
export const PROVINCE_TITLES: Record<
  string,
  Partial<Record<Exclude<Locale, 'zh-Hant'>, string>>
> = {
  zhili: { 'zh-Hans': '直隶', en: 'Zhili' },
  shandong: { 'zh-Hans': '山东', en: 'Shandong' },
  shanxi: { 'zh-Hans': '山西', en: 'Shanxi' },
  henan: { 'zh-Hans': '河南', en: 'Henan' },
  shaanxi: { 'zh-Hans': '陕西', en: 'Shaanxi' },
  gansu: { 'zh-Hans': '甘肃', en: 'Gansu' },
  sichuan: { 'zh-Hans': '四川', en: 'Sichuan' },
  hubei: { 'zh-Hans': '湖北', en: 'Hubei' },
  hunan: { 'zh-Hans': '湖南', en: 'Hunan' },
  jiangxi: { 'zh-Hans': '江西', en: 'Jiangxi' },
  anhui: { 'zh-Hans': '安徽', en: 'Anhui' },
  jiangnan: { 'zh-Hans': '江南', en: 'Jiangnan' },
  suzhou: { 'zh-Hans': '苏州', en: 'Suzhou' },
  zhejiang: { 'zh-Hans': '浙江', en: 'Zhejiang' },
  fujian: { 'zh-Hans': '福建', en: 'Fujian' },
  guangdong: { 'zh-Hans': '广东', en: 'Guangdong' },
  guangxi: { 'zh-Hans': '广西', en: 'Guangxi' },
  yunnan: { 'zh-Hans': '云南', en: 'Yunnan' },
  guizhou: { 'zh-Hans': '贵州', en: 'Guizhou' },
  xinjiang: { 'zh-Hans': '新疆', en: 'Xinjiang' },
  xizang: { 'zh-Hans': '西藏', en: 'Xizang' },
  menggu: { 'zh-Hans': '蒙古', en: 'Mongolia' },
  shengjing: { 'zh-Hans': '盛京', en: 'Shengjing' },
  jilin: { 'zh-Hans': '吉林', en: 'Jilin' },
  heilongjiang: { 'zh-Hans': '黑龙江', en: 'Heilongjiang' },
  qinghai: { 'zh-Hans': '青海', en: 'Qinghai' },
}
