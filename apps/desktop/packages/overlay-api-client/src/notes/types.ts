import type { NoteQueryContract } from '@overlay/app-core'
import type { FileQuery } from '../files/types'

export type NoteQuery = NoteQueryContract

export type NoteFileQuery = Omit<FileQuery, 'kind'>
