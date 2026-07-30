import type { DoxaManifest } from '@doxajs/manifest'

import { handbookIndex, type HandbookEntry } from './handbook.js'

export interface DocumentationSection extends HandbookEntry {}

export interface DocumentationSearchResult extends DocumentationSection {
  readonly score: number
}

export const MAX_DOCUMENTATION_RESULTS = 20

export function documentationIndex(
  version: string,
  manifest?: DoxaManifest,
): readonly DocumentationSection[] {
  return handbookIndex(version, manifest)
}

export function searchDocumentation(
  sections: readonly DocumentationSection[],
  query: string,
  limit = 10,
): readonly DocumentationSearchResult[] {
  const normalized = query.trim().toLowerCase()
  if (normalized.length === 0 || normalized.length > 200) {
    throw new Error('Documentation query must contain 1 through 200 characters.')
  }
  const tokens = [...new Set(normalized.split(/\s+/).filter(Boolean))]
  return Object.freeze(
    sections
      .map((entry) => {
        const heading = entry.heading.toLowerCase()
        const exact = entry.id.toLowerCase() === normalized || entry.role === normalized
        const exactAlias = entry.aliases.some((alias) => alias.toLowerCase() === normalized)
        const haystack = [
          entry.id,
          entry.kind,
          entry.package,
          entry.source,
          entry.heading,
          entry.summary,
          entry.rationale,
          entry.text,
          ...entry.aliases,
        ]
          .join(' ')
          .toLowerCase()
        const score =
          (exact ? 20 : 0) +
          (exactAlias ? 15 : 0) +
          tokens.reduce(
            (total, token) =>
              total +
              (entry.id.toLowerCase().includes(token)
                ? 6
                : heading.includes(token)
                  ? 3
                  : haystack.includes(token)
                    ? 1
                    : 0),
            0,
          )
        return { ...entry, score }
      })
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
      .slice(0, Math.min(Math.max(limit, 1), MAX_DOCUMENTATION_RESULTS)),
  )
}
