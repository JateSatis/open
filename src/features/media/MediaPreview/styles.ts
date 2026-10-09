import { StyleSheet } from 'react-native';

import { Radii, Sizes, Spacing, Typography } from '@/theme';

export const styles = StyleSheet.create({
  layer: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  },
  frame: {
    position: 'absolute',
    overflow: 'hidden',
  },
  thumb: {
    position: 'absolute',
  },
  header: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
  },
  headerButton: {
    width: Sizes.previewHeaderButton,
    height: Sizes.previewHeaderButton,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circle: {
    width: Sizes.previewSelection,
    height: Sizes.previewSelection,
    borderRadius: Radii.full,
    borderWidth: Sizes.previewLine,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: Spacing.two,
    gap: Spacing.two,
  },
  captionRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.two,
    paddingHorizontal: Spacing.two,
  },
  captionField: {
    flex: 1,
    maxHeight: Sizes.previewCaptionMax,
    borderRadius: Radii.lg,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    ...Typography.body,
  },
  sendButton: {
    width: Sizes.previewSendButton,
    height: Sizes.previewSendButton,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tools: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
  },
  tool: {
    width: Sizes.previewTool,
    height: Sizes.previewTool,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolPanel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: Spacing.three,
    gap: Spacing.two,
  },
  sliderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    height: Sizes.previewSliderRow,
  },
  sliderLabel: {
    width: Sizes.previewSliderLabel,
  },
  sliderTrack: {
    flex: 1,
    height: Sizes.previewSliderRow,
    justifyContent: 'center',
  },
  sliderLine: {
    height: Sizes.previewLine,
    borderRadius: Radii.full,
  },
  sliderFill: {
    position: 'absolute',
    height: Sizes.previewLine,
  },
  sliderZero: {
    position: 'absolute',
    width: Sizes.previewLine,
    height: Spacing.three,
    borderRadius: Radii.full,
  },
  sliderThumb: {
    position: 'absolute',
    width: Sizes.previewSliderThumb,
    height: Sizes.previewSliderThumb,
    borderRadius: Radii.full,
  },
  toolActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    height: Sizes.previewToolActions,
  },
  brushRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: Spacing.two,
  },
  brush: {
    borderRadius: Radii.full,
  },
  drawTop: {
    position: 'absolute',
    left: 0,
    top: 0,
    paddingHorizontal: Spacing.three,
  },
  sizeColumn: {
    position: 'absolute',
    right: 0,
    width: Sizes.drawSliderHit,
    justifyContent: 'center',
  },
  sizeSlider: {
    width: Sizes.drawSliderHit,
    height: Sizes.drawSliderHeight,
  },
  sizeTrack: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: Sizes.drawSliderHit,
    height: Sizes.drawSliderHeight,
  },
  sizeThumb: {
    position: 'absolute',
  },
  sizePreview: {
    position: 'absolute',
    borderWidth: Sizes.drawSizeOutline,
  },
  rulerRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.two,
    paddingHorizontal: Spacing.two,
  },
  ruler: {
    flex: 1,
    height: Sizes.cropRulerHeight,
    overflow: 'hidden',
  },
  rulerCanvas: {
    flex: 1,
  },
  toast: {
    position: 'absolute',
    alignSelf: 'center',
    borderRadius: Radii.md,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
});
