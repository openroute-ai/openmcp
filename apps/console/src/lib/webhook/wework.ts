/**
 * WeCom (企业微信) bot messages from ranked projects.
 *
 * The source app sent top projects to WeCom from a static-API file with
 * `trends.daily` deltas. The console stores weekly granularity, not daily, so
 * the numbers are a week's gain; the message shape is unchanged and is the one
 * WeCom's group-bot webhook expects (`msgtype: "news"`).
 */

export interface RankedForMessage {
  name: string
  fullName: string
  description: string
  delta: number
  ownerId: number
}

export interface WeWorkNewsArticle {
  title: string
  description: string
  url: string
  picurl: string
}

export interface WeWorkNewsMessage {
  msgtype: "news"
  news: { articles: WeWorkNewsArticle[] }
}

/**
 * One project as a WeCom news article.
 *
 * The avatar is built from the owner id rather than fetched: GitHub serves
 * user avatars at that URL and the image is only a thumbnail, so there is no
 * asset to fetch, validate or host.
 */
export function projectToWeWorkArticle(
  project: RankedForMessage,
  position: number,
  periodLabel: string
): WeWorkNewsArticle {
  return {
    title: project.name,
    description: `Number ${position} +${project.delta} stars ${periodLabel}:\n${project.description}`,
    url: `https://github.com/${project.fullName}`,
    picurl: `https://avatars.githubusercontent.com/u/${project.ownerId}?v=3&s=75`,
  }
}

/** Wraps the articles in the WeCom group-bot envelope. */
export function buildWeWorkNewsMessage(
  articles: WeWorkNewsArticle[]
): WeWorkNewsMessage {
  return { msgtype: "news", news: { articles } }
}
