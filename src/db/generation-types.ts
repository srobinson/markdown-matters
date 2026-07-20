declare const GenerationNameBrand: unique symbol

export type GenerationName = string & {
  readonly [GenerationNameBrand]: typeof GenerationNameBrand
}

export interface GenerationHomeLayout {
  readonly home: string
  readonly current: string
  readonly staging: string
  readonly writerLock: string
  readonly writerReclaim: string
}

export interface GenerationLayout {
  readonly home: string
  readonly name: GenerationName
  readonly root: string
  readonly leasesRoot: string
  readonly openLeases: string
  readonly closedLeases: string
}

export interface WriterLockRecord {
  readonly token: string
  readonly holder: import('./process-identity.js').ProcessIdentity
  readonly createdAt: string
}

export interface GenerationLeaseRecord {
  readonly leaseId: string
  readonly holder: import('./process-identity.js').ProcessIdentity
  readonly createdAt: string
}

export interface GenerationReadSession {
  readonly home: string
  readonly generation: GenerationName
  readonly indexRoot: string
  readonly leaseId: string
}

export interface GenerationBuildContext {
  readonly home: string
  readonly previous: GenerationName | null
  readonly generation: GenerationName
  readonly indexRoot: string
}

export interface PublishedGeneration<A> {
  readonly generation: GenerationName
  readonly indexRoot: string
  readonly value: A
}

export interface GenerationReaperOptions {
  readonly graceMs: number
  readonly inspector?: import('./process-identity.js').ProcessInspector
  readonly now?: () => number
  readonly onReaped?: (layout: GenerationLayout) => void
}

export interface ReapResult {
  readonly generation: GenerationName
  readonly status: 'current' | 'leased' | 'grace' | 'reaped'
}
