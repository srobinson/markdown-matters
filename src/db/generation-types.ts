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
