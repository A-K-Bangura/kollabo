import { describe, expect, it } from 'vitest'
import { parseNameList } from './names'

describe('parseNameList', () => {
  it('accepts lines, commas and semicolons, and trims and collapses spaces', () => {
    const result = parseNameList('  Ada  Lovelace \nGrace Hopper,Alan Turing; Edsger Dijkstra\r\n\n')
    expect(result.names).toEqual(['Ada Lovelace', 'Grace Hopper', 'Alan Turing', 'Edsger Dijkstra'])
  })

  it('drops repeats regardless of case and reports them', () => {
    const result = parseNameList('Ada\nada\nADA\nGrace')
    expect(result.names).toEqual(['Ada', 'Grace'])
    expect(result.duplicates).toEqual(['ada', 'ADA'])
  })

  it('sets aside names that are too long to be names', () => {
    const long = 'x'.repeat(41)
    const result = parseNameList(`Ada\n${long}`)
    expect(result.names).toEqual(['Ada'])
    expect(result.tooLong).toEqual([long])
  })

  it('handles empty input', () => {
    expect(parseNameList('').names).toEqual([])
    expect(parseNameList(' \n , ; ').names).toEqual([])
  })
})
