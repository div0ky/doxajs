import { parseClientFrame } from '@doxajs/keryx'
import { Realtime, type RealtimeSocket } from '@doxajs/realtime'
import { afterEach, describe, expect, it, vi } from 'vitest'

class TestSocket implements RealtimeSocket {
  readyState = 1
  onopen: ((event: unknown) => void) | null = null
  onmessage: ((event: { readonly data: unknown }) => void) | null = null
  onclose: ((event: { readonly code?: number; readonly reason?: string }) => void) | null = null
  onerror: ((event: unknown) => void) | null = null
  readonly sent: string[] = []

  send(data: string): void {
    this.sent.push(data)
  }

  close(code?: number, reason?: string): void {
    this.readyState = 3
    this.onclose?.({
      ...(code === undefined ? {} : { code }),
      ...(reason === undefined ? {} : { reason }),
    })
  }
}

describe('Realtime commands', () => {
  afterEach(() => vi.useRealTimers())

  it('rejects locally while disconnected and never queues the command', async () => {
    const socket = new TestSocket()
    const realtime = new Realtime({ url: 'ws://example.test/app', socketFactory: () => socket })

    await expect(
      realtime.command('direct-messages.typing', { conversationId: 'one' }),
    ).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        error: { code: 'command_not_connected', message: expect.any(String) },
      }),
    )
    expect(socket.sent).toEqual([])
  })

  it('sends protocol v3 frames after connected and resolves the matching acknowledgement', async () => {
    const socket = new TestSocket()
    const realtime = new Realtime({
      url: 'ws://example.test/app',
      reconnect: false,
      socketFactory: () => socket,
    })
    realtime.connect()
    socket.onopen?.({})
    socket.onmessage?.({
      data: JSON.stringify({ protocol: 3, type: 'connected', connectionId: 'socket-1' }),
    })

    const result = realtime.command('direct-messages.typing', { conversationId: 'one' })
    const frame = JSON.parse(socket.sent.at(-1)!) as Record<string, unknown>
    expect(parseClientFrame(JSON.stringify(frame))).toEqual(frame)
    socket.onmessage?.({
      data: JSON.stringify({ protocol: 3, type: 'command_ack', id: frame.id, ok: true }),
    })

    await expect(result).resolves.toEqual({ id: frame.id, ok: true })
    realtime.disconnect()
  })

  it('settles pending commands on disconnect without retrying', async () => {
    const socket = new TestSocket()
    const realtime = new Realtime({
      url: 'ws://example.test/app',
      reconnect: false,
      socketFactory: () => socket,
    })
    realtime.connect()
    socket.onmessage?.({
      data: JSON.stringify({ protocol: 3, type: 'connected', connectionId: 'socket-1' }),
    })
    const result = realtime.command('presence.cursor', { x: 1 })
    const sent = socket.sent.length
    realtime.disconnect()

    await expect(result).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        error: { code: 'command_disconnected', message: expect.any(String) },
      }),
    )
    expect(socket.sent).toHaveLength(sent)
  })

  it('preserves bounded server failures and retry guidance', async () => {
    const socket = new TestSocket()
    const realtime = new Realtime({
      url: 'ws://example.test/app',
      reconnect: false,
      socketFactory: () => socket,
    })
    realtime.connect()
    socket.onmessage?.({
      data: JSON.stringify({ protocol: 3, type: 'connected', connectionId: 'socket-1' }),
    })
    const result = realtime.command('presence.cursor', { x: 1 })
    const frame = JSON.parse(socket.sent.at(-1)!) as Record<string, unknown>
    socket.onmessage?.({
      data: JSON.stringify({
        protocol: 3,
        type: 'command_ack',
        id: frame.id,
        ok: false,
        error: {
          code: 'command_throttled',
          message: 'That command is being sent too frequently.',
          retryAfterMs: 125,
        },
      }),
    })

    await expect(result).resolves.toEqual({
      id: frame.id,
      ok: false,
      error: {
        code: 'command_throttled',
        message: 'That command is being sent too frequently.',
        retryAfterMs: 125,
      },
    })
    realtime.disconnect()
  })

  it('settles acknowledgement timeouts and ignores late acknowledgements', async () => {
    vi.useFakeTimers()
    const socket = new TestSocket()
    const realtime = new Realtime({
      url: 'ws://example.test/app',
      reconnect: false,
      commandTimeoutMilliseconds: 50,
      socketFactory: () => socket,
    })
    realtime.connect()
    socket.onmessage?.({
      data: JSON.stringify({ protocol: 3, type: 'connected', connectionId: 'socket-1' }),
    })
    const result = realtime.command('presence.cursor', { x: 1 })
    const frame = JSON.parse(socket.sent.at(-1)!) as Record<string, unknown>

    await vi.advanceTimersByTimeAsync(50)
    await expect(result).resolves.toEqual(
      expect.objectContaining({
        id: frame.id,
        ok: false,
        error: expect.objectContaining({ code: 'command_ack_timeout' }),
      }),
    )
    socket.onmessage?.({
      data: JSON.stringify({ protocol: 3, type: 'command_ack', id: frame.id, ok: true }),
    })
    await expect(result).resolves.toEqual(
      expect.objectContaining({ error: expect.objectContaining({ code: 'command_ack_timeout' }) }),
    )
    realtime.disconnect()
  })
})
