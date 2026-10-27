/* Tiny API around LAME for the browser: create, feed 16-bit planar PCM, get MP3 bytes. */
#include "lame.h"
#include <stdlib.h>
static lame_global_flags *gf;
static short *pcm_l, *pcm_r; static int pcm_cap;
static unsigned char *out; static int out_cap;
#define EXPORT __attribute__((visibility("default")))
EXPORT int enc_create(int channels, int sample_rate, int kbps, int quality) {
  gf = lame_init(); if (!gf) return -1;
  lame_set_num_channels(gf, channels);
  lame_set_in_samplerate(gf, sample_rate);
  lame_set_out_samplerate(gf, sample_rate);
  lame_set_brate(gf, kbps);
  lame_set_mode(gf, channels == 1 ? MONO : JOINT_STEREO);
  lame_set_quality(gf, quality);
  lame_set_bWriteVbrTag(gf, 0);
  return lame_init_params(gf);
}
/* Allocates room for `frames` samples per channel; returns pointer to left, right follows at enc_right_ptr(). */
EXPORT short *enc_left(int frames) {
  if (frames > pcm_cap) { free(pcm_l); free(pcm_r); pcm_l = malloc(frames * 2); pcm_r = malloc(frames * 2); pcm_cap = frames; }
  return pcm_l;
}
EXPORT short *enc_right(void) { return pcm_r; }
static void need_out(int n) { if (n > out_cap) { free(out); out = malloc(n); out_cap = n; } }
EXPORT unsigned char *enc_out(void) { return out; }
EXPORT int enc_encode(int frames, int stereo) {
  need_out((int)(1.25 * frames + 7200));
  return lame_encode_buffer(gf, pcm_l, stereo ? pcm_r : pcm_l, frames, out, out_cap);
}
EXPORT int enc_flush(void) {
  need_out(8192);
  int n = lame_encode_flush(gf, out, out_cap);
  return n;
}
EXPORT void enc_close(void) { if (gf) lame_close(gf); gf = 0; }
