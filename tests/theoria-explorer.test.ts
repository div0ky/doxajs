import vm from 'node:vm'

import { listenTheoria } from '@doxajs/theoria'
import { expect, it } from 'vitest'

class Element {
  className = ''
  dataset: Record<string, string> = {}
  #innerHTML = ''
  onclick?: () => void
  oninput?: () => void
  onRender?: (html: string) => void
  scrollLeft = 0
  scrollTop = 0
  style: Record<string, string> = {}
  textContent = ''

  classList = { toggle: () => undefined }
  get innerHTML(): string {
    return this.#innerHTML
  }
  set innerHTML(value: string) {
    this.#innerHTML = value
    this.scrollLeft = 0
    this.scrollTop = 0
    this.onRender?.(value)
  }
  scrollTo(left: number, top: number): void {
    this.scrollLeft = left
    this.scrollTop = top
  }
}

it('preserves Theoria navigation and scroll state across polling and stale responses', async () => {
  const host = await listenTheoria({ connectionString: 'postgres://unused', port: 0 })
  try {
    const html = await (await fetch(host.url)).text()
    const script = html.match(/<script type="module">([\s\S]+)<\/script>/)?.[1]
    expect(script).toBeTruthy()

    const elements = new Map<string, Element>()
    const element = (id: string): Element => {
      const existing = elements.get(id)
      if (existing) return existing
      const created = new Element()
      elements.set(id, created)
      return created
    }
    const delayed: { entries?: PromiseWithResolvers<unknown[]> } = {}
    const requests: string[] = []
    let codeElements: Element[] = []
    let delayedTimelineA: PromiseWithResolvers<unknown[]> | undefined
    const failedExecutions = new Set<string>()
    let entries = [entry('execution-a', 'observation-a')]
    const timelines = new Map([
      [
        'execution-a',
        [
          observation('execution-a', 'observation-a'),
          observation('execution-a', 'observation-a-selected'),
        ],
      ],
      ['execution-b', [observation('execution-b', 'observation-b')]],
    ])
    element('inspector').onRender = (html) => {
      codeElements = Array.from(
        { length: html.match(/class="code"/g)?.length ?? 0 },
        () => new Element(),
      )
    }
    const context = vm.createContext({
      URLSearchParams,
      clearTimeout,
      console,
      document: {
        getElementById: element,
        querySelector: () => new Element(),
        querySelectorAll: (selector: string) =>
          selector === '#inspector .code' ? codeElements : [],
      },
      fetch: async (url: string) => {
        requests.push(url)
        return {
          json: async () => {
            if (
              url.startsWith('/api/timeline/') &&
              failedExecutions.has(url.slice('/api/timeline/'.length))
            ) {
              throw new Error('detail failed')
            }
            return {
              ok: true,
              data: url.startsWith('/api/entries')
                ? delayed.entries
                  ? await delayed.entries.promise
                  : entries
                : url === '/api/timeline/execution-a' && delayedTimelineA
                  ? await delayedTimelineA.promise
                  : url.startsWith('/api/timeline/')
                    ? timelines.get(url.slice('/api/timeline/'.length))
                    : [],
            }
          },
          ok: true,
        }
      },
      setTimeout,
    })
    vm.runInContext(
      script!.replace(
        'loadExecutions();setInterval(loadExecutions,3000);',
        'globalThis.state=state;globalThis.loadExecutions=loadExecutions;globalThis.chooseExecution=chooseExecution;globalThis.renderInspector=renderInspector;',
      ),
      context,
    )

    await vm.runInContext('loadExecutions()', context)
    vm.runInContext('state.observation=state.timeline[1];renderInspector()', context)
    element('executions').scrollTo(7, 70)
    element('timeline').scrollTo(8, 80)
    element('inspector').scrollTo(9, 90)
    codeElements[0]?.scrollTo(10, 100)
    entries = [entry('execution-b', 'observation-b')]
    await vm.runInContext('loadExecutions()', context)

    expect(vm.runInContext('state.execution', context)).toBe('execution-a')
    expect(vm.runInContext('state.observation.id', context)).toBe('observation-a-selected')
    expect([
      element('executions'),
      element('timeline'),
      element('inspector'),
      codeElements[0],
    ]).toMatchObject([
      { scrollLeft: 7, scrollTop: 70 },
      { scrollLeft: 8, scrollTop: 80 },
      { scrollLeft: 9, scrollTop: 90 },
      { scrollLeft: 10, scrollTop: 100 },
    ])

    delayedTimelineA = Promise.withResolvers<unknown[]>()
    const stale = vm.runInContext("chooseExecution('execution-a')", context) as Promise<void>
    await vm.runInContext("state.reset=false;chooseExecution('execution-b')", context)
    delayedTimelineA.resolve(timelines.get('execution-a')!)
    await stale
    delayedTimelineA = undefined
    expect(vm.runInContext('state.execution', context)).toBe('execution-b')
    expect(vm.runInContext('state.observation.id', context)).toBe('observation-b')

    entries = [entry('execution-a', 'observation-a'), entry('execution-b', 'observation-b')]
    element('executions').scrollTo(0, 70)
    delayed.entries = Promise.withResolvers<unknown[]>()
    const polling = vm.runInContext('loadExecutions()', context) as Promise<void>
    vm.runInContext("state.kind='event';loadExecutions(true)", context)
    await vm.runInContext("state.reset=false;chooseExecution('execution-b')", context)
    delayed.entries.resolve(entries)
    await polling
    while (vm.runInContext('state.loading', context)) {
      await new Promise<void>((resolve) => setImmediate(resolve))
    }
    expect(vm.runInContext('state.reload', context)).toBe(false)
    expect(vm.runInContext('state.execution', context)).toBe('execution-b')
    expect(requests.filter((url) => url === '/api/entries?kind=event')).toHaveLength(1)
    expect(element('executions').scrollTop).toBe(70)

    await vm.runInContext("chooseExecution('execution-a')", context)
    vm.runInContext('state.observation=state.timeline[0];renderInspector()', context)
    delayedTimelineA = Promise.withResolvers<unknown[]>()
    const refresh = vm.runInContext(
      "chooseExecution('execution-a',undefined,true)",
      context,
    ) as Promise<void>
    vm.runInContext('state.observation=state.timeline[1];renderInspector()', context)
    element('timeline').scrollTo(12, 120)
    element('inspector').scrollTo(13, 130)
    codeElements[0]?.scrollTo(14, 140)
    delayedTimelineA.resolve(timelines.get('execution-a')!)
    await refresh
    delayedTimelineA = undefined
    expect(vm.runInContext('state.observation.id', context)).toBe('observation-a-selected')
    expect([element('timeline'), element('inspector'), codeElements[0]]).toMatchObject([
      { scrollLeft: 12, scrollTop: 120 },
      { scrollLeft: 13, scrollTop: 130 },
      { scrollLeft: 14, scrollTop: 140 },
    ])

    delayed.entries = Promise.withResolvers<unknown[]>()
    const filtering = vm.runInContext('loadExecutions(true)', context) as Promise<void>
    await vm.runInContext("state.reset=false;chooseExecution('execution-b')", context)
    delayed.entries.resolve(entries)
    await filtering
    delete delayed.entries
    expect(vm.runInContext('state.execution', context)).toBe('execution-b')

    delayed.entries = Promise.withResolvers<unknown[]>()
    const staleListFailure = vm.runInContext('loadExecutions(true)', context) as Promise<void>
    await vm.runInContext("state.reset=false;chooseExecution('execution-b')", context)
    delayed.entries.reject(new Error('stale list failed'))
    await staleListFailure
    delete delayed.entries
    expect(element('error').style.display).toBe('none')

    delayedTimelineA = Promise.withResolvers<unknown[]>()
    const pendingExecutionA = vm.runInContext(
      "state.reset=false;chooseExecution('execution-a')",
      context,
    ) as Promise<void>
    failedExecutions.add('execution-b')
    await vm.runInContext("state.reset=false;chooseExecution('execution-b')", context)
    failedExecutions.delete('execution-b')
    expect(vm.runInContext('state.execution', context)).toBe('execution-b')
    expect(vm.runInContext('state.observation.id', context)).toBe('observation-b')
    delayedTimelineA.resolve(timelines.get('execution-a')!)
    await pendingExecutionA
    delayedTimelineA = undefined
    expect(vm.runInContext('state.execution', context)).toBe('execution-b')

    failedExecutions.add('execution-a')
    await vm.runInContext("chooseExecution('execution-a')", context)
    failedExecutions.delete('execution-a')
    expect(vm.runInContext('state.execution', context)).toBe('execution-b')
    expect(element('error')).toMatchObject({ style: { display: 'block' } })

    delayedTimelineA = Promise.withResolvers<unknown[]>()
    const staleDetail = vm.runInContext("chooseExecution('execution-a')", context) as Promise<void>
    entries = []
    await vm.runInContext('loadExecutions(true)', context)
    delayedTimelineA.resolve(timelines.get('execution-a')!)
    await staleDetail
    delayedTimelineA = undefined
    expect(vm.runInContext('state.execution', context)).toBe(null)
    expect(vm.runInContext('state.timeline', context)).toEqual([])
    expect(element('timeline').innerHTML).toContain('No evidence recorded')
    expect(element('inspector').innerHTML).toContain('No observation selected')
    expect(element('correlation').textContent).toBe('')
  } finally {
    await host.shutdown()
  }
})

function entry(executionId: string, entryId: string) {
  return {
    durationMilliseconds: 1,
    entryId,
    executionId,
    kind: 'log',
    name: entryId,
    occurredAt: '2026-08-04T00:00:00.000Z',
    phase: 'completed',
  }
}

function observation(executionId: string, id: string) {
  return {
    attributes: {},
    context: { executionId },
    durationMilliseconds: 1,
    id,
    kind: 'log',
    name: id,
    occurredAt: '2026-08-04T00:00:00.000Z',
    phase: 'completed',
  }
}
