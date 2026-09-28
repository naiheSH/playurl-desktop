import { describe, expect, it } from 'vitest'
import { endpointFor, normalizeSong } from './providers'

describe('provider adapters', () => {
  it('maps provider routes without exposing implementation details to the UI', () => {
    expect(endpointFor('netease', 'url')).toBe('/api/song/url')
    expect(endpointFor('qq', 'search')).toBe('/api/qq/search')
    expect(endpointFor('qishui', 'status')).toBe('/api/qishui/login/status')
  })

  it('normalizes heterogeneous search records', () => {
    expect(normalizeSong({ songmid: 'abc', songname: 'Song', singer: [{ name: 'Artist' }], album: 'Album' }, 'qq')).toMatchObject({
      provider: 'qq', id: 'abc', name: 'Song', artist: 'Artist', album: 'Album'
    })
    expect(normalizeSong({ FileHash: 'HASH', filename: 'Track', author: 'Singer' }, 'kugou')).toMatchObject({
      provider: 'kugou', id: 'HASH', name: 'Track', artist: 'Singer'
    })
  })
})
