/**
 * i18n 字段工具函数
 * 用于根据 locale 选择对应的中英文字段
 */

/**
 * 根据 locale 获取本地化的字段值
 * @param zh 中文字段值
 * @param en 英文字段值
 * @param locale 当前语言环境
 * @returns 对应语言的字段值
 */
export function getLocalizedField<T extends string | null | undefined>(zh: T, en: T, locale: 'zh' | 'en'): T {
  if (locale === 'zh') {
    return zh ?? en ?? ('' as T)
  }
  return en ?? zh ?? ('' as T)
}

/**
 * 获取本地化的分类数据
 */
export function getLocalizedCategory<
  T extends {
    name: string
    nameEn: string
    description: string | null
    descriptionEn: string | null
  },
>(category: T, locale: 'zh' | 'en'): T {
  return {
    ...category,
    name: getLocalizedField(category.name, category.nameEn, locale),
    description: getLocalizedField(category.description, category.descriptionEn, locale),
  } as T
}

/**
 * 获取本地化的工作流数据
 */
export function getLocalizedWorkflow<
  T extends {
    title: string
    titleEn: string | null
    description: string | null
    descriptionEn: string | null
    summary: string | null
    readme: string | null
    readmeEn: string | null
  },
>(workflow: T, locale: 'zh' | 'en'): T {
  return {
    ...workflow,
    title: getLocalizedField(workflow.title, workflow.titleEn, locale),
    description: getLocalizedField(workflow.description, workflow.descriptionEn, locale),
    readme:
      locale === 'zh'
        ? getLocalizedField(workflow.readme, workflow.readmeEn, locale)
        : getLocalizedField(workflow.readmeEn, workflow.readme, locale),
  } as T
}
