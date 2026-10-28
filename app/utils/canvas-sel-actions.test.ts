import { describe, expect, it, vi } from 'vitest'
import { dispatchCanvasSelAction, type CanvasSelActionApi } from './canvas-sel-actions'

function api(overrides: Partial<CanvasSelActionApi> = {}): CanvasSelActionApi {
  const noop = () => {}
  return {
    group: noop,
    ungroup: noop,
    collapse: noop,
    duplicate: noop,
    shrink: noop,
    grow: noop,
    download: noop,
    expand: noop,
    regen: noop,
    brush: noop,
    inpaint: noop,
    smartEdit: noop,
    depth: noop,
    light: noop,
    multiview: noop,
    promptReverse: noop,
    crop: noop,
    frameCrop: noop,
    removeSubtitles: noop,
    boxSubtitles: noop,
    separate: noop,
    extractVoice: noop,
    extractBgm: noop,
    transcribe: noop,
    removeSilence: noop,
    outpaint: noop,
    flip: noop,
    runUpscale: noop,
    runRemoveBg: noop,
    runThreeView: noop,
    hd: noop,
    viral: noop,
    videoSplit: noop,
    retake: noop,
    smartExtend: noop,
    clipCut: noop,
    frameByFrame: noop,
    depthMotion: noop,
    smartMatting: noop,
    captureFrame: noop,
    captureFirst: noop,
    captureLast: noop,
    runSubject: noop,
    runImageEdit: noop,
    saveWorkflow: noop,
    fallback: noop,
    ...overrides,
  }
}

describe('dispatchCanvasSelAction', () => {
  it('具名动作走对应回调', () => {
    const group = vi.fn()
    dispatchCanvasSelAction('group', api({ group }))
    expect(group).toHaveBeenCalledOnce()
  })

  it('超分带倍数走 runUpscale，光 upscale 不做事', () => {
    const runUpscale = vi.fn()
    const fallback = vi.fn()
    dispatchCanvasSelAction('upscale-2x', api({ runUpscale, fallback }))
    expect(runUpscale).toHaveBeenCalledWith(2)
    dispatchCanvasSelAction('upscale', api({ runUpscale, fallback }))
    expect(runUpscale).toHaveBeenCalledOnce()
    expect(fallback).not.toHaveBeenCalled()
  })

  it('主体动作和未知动作分别走 runSubject / fallback', () => {
    const runSubject = vi.fn()
    const fallback = vi.fn()
    dispatchCanvasSelAction('remove-subject', api({ runSubject, fallback }))
    expect(runSubject).toHaveBeenCalledWith('remove-subject')
    dispatchCanvasSelAction('edit-subject', api({ runSubject, fallback }))
    expect(runSubject).toHaveBeenCalledWith('edit-subject')
    dispatchCanvasSelAction('replace-subject', api({ runSubject, fallback }))
    expect(runSubject).toHaveBeenCalledWith('replace-subject')
    dispatchCanvasSelAction('not-a-real-action', api({ runSubject, fallback }))
    expect(fallback).toHaveBeenCalledOnce()
  })

  it('人声 / 背景音分离、框选去字幕、抽帧、逐帧拉片走对应回调', () => {
    const extractVoice = vi.fn()
    const extractBgm = vi.fn()
    const boxSubtitles = vi.fn()
    const captureFrame = vi.fn()
    const captureFirst = vi.fn()
    const captureLast = vi.fn()
    const frameByFrame = vi.fn()
    dispatchCanvasSelAction('extract-voice', api({ extractVoice }))
    expect(extractVoice).toHaveBeenCalledOnce()
    dispatchCanvasSelAction('extract-bgm', api({ extractBgm }))
    expect(extractBgm).toHaveBeenCalledOnce()
    dispatchCanvasSelAction('box-subtitles', api({ boxSubtitles }))
    expect(boxSubtitles).toHaveBeenCalledOnce()
    dispatchCanvasSelAction('capture-frame', api({ captureFrame }))
    expect(captureFrame).toHaveBeenCalledOnce()
    dispatchCanvasSelAction('capture-first', api({ captureFirst }))
    expect(captureFirst).toHaveBeenCalledOnce()
    dispatchCanvasSelAction('capture-last', api({ captureLast }))
    expect(captureLast).toHaveBeenCalledOnce()
    dispatchCanvasSelAction('frame-by-frame', api({ frameByFrame }))
    expect(frameByFrame).toHaveBeenCalledOnce()
  })

  it('深度提取走 depth 回调，不走 runImageEdit', () => {
    const depth = vi.fn()
    const runImageEdit = vi.fn()
    dispatchCanvasSelAction('depth', api({ depth, runImageEdit }))
    expect(depth).toHaveBeenCalledOnce()
    expect(runImageEdit).not.toHaveBeenCalled()
  })

  it('存为工作流走 saveWorkflow', () => {
    const saveWorkflow = vi.fn()
    const fallback = vi.fn()
    dispatchCanvasSelAction('save-workflow', api({ saveWorkflow, fallback }))
    expect(saveWorkflow).toHaveBeenCalledOnce()
    expect(fallback).not.toHaveBeenCalled()
  })
})
