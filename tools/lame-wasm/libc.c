/* Minimal libc for LAME on wasm32 (freestanding). Math comes from the host (JS Math). */
#include <stddef.h>
#include <stdarg.h>
typedef unsigned char u8;

/* ---- memory: simple first-fit allocator with size header, grows linear memory ---- */
extern unsigned char __heap_base;
static unsigned long heap_end = 0;
typedef struct blk { unsigned long size; struct blk *next; } blk;  /* size includes header; low bit = used */
static blk *free_list = 0;
static void *grow(unsigned long n) {
  if (!heap_end) heap_end = ((unsigned long)&__heap_base + 15) & ~15UL;
  unsigned long start = heap_end;
  unsigned long need = start + n;
  unsigned long cur = __builtin_wasm_memory_size(0) * 65536UL;
  if (need > cur) {
    unsigned long pages = (need - cur + 65535) / 65536;
    if (__builtin_wasm_memory_grow(0, pages) == (size_t)-1) return 0;
  }
  heap_end = need;
  return (void *)start;
}
void *malloc(size_t n) {
  if (n == 0) n = 1;
  unsigned long total = ((n + 15) & ~15UL) + 16;
  blk **pp = &free_list;
  while (*pp) {
    blk *b = *pp;
    if (b->size >= total) { *pp = b->next; b->next = 0; return (u8 *)b + 16; }
    pp = &b->next;
  }
  blk *b = (blk *)grow(total);
  if (!b) return 0;
  b->size = total; b->next = 0;
  return (u8 *)b + 16;
}
void free(void *p) {
  if (!p) return;
  blk *b = (blk *)((u8 *)p - 16);
  b->next = free_list; free_list = b;
}
void *memset(void *d, int c, size_t n) { u8 *p = d; while (n--) *p++ = (u8)c; return d; }
void *memcpy(void *d, const void *s, size_t n) { u8 *a = d; const u8 *b = s; while (n--) *a++ = *b++; return d; }
void *memmove(void *d, const void *s, size_t n) {
  u8 *a = d; const u8 *b = s;
  if (a < b) while (n--) *a++ = *b++; else { a += n; b += n; while (n--) *--a = *--b; }
  return d;
}
int memcmp(const void *x, const void *y, size_t n) { const u8 *a = x, *b = y; while (n--) { if (*a != *b) return *a - *b; a++; b++; } return 0; }
void *calloc(size_t a, size_t b) { size_t n = a * b; void *p = malloc(n); if (p) memset(p, 0, n); return p; }
void *realloc(void *p, size_t n) {
  if (!p) return malloc(n);
  blk *b = (blk *)((u8 *)p - 16);
  size_t have = b->size - 16;
  if (n <= have) return p;
  void *q = malloc(n); if (!q) return 0;
  memcpy(q, p, have); free(p); return q;
}
size_t strlen(const char *s) { size_t n = 0; while (s[n]) n++; return n; }
char *strcpy(char *d, const char *s) { char *r = d; while ((*d++ = *s++)); return r; }
char *strncpy(char *d, const char *s, size_t n) { size_t i = 0; for (; i < n && s[i]; i++) d[i] = s[i]; for (; i < n; i++) d[i] = 0; return d; }
char *strcat(char *d, const char *s) { strcpy(d + strlen(d), s); return d; }
int strcmp(const char *a, const char *b) { while (*a && *a == *b) { a++; b++; } return (u8)*a - (u8)*b; }
int strncmp(const char *a, const char *b, size_t n) { while (n && *a && *a == *b) { a++; b++; n--; } return n ? (u8)*a - (u8)*b : 0; }
char *strchr(const char *s, int c) { for (;; s++) { if (*s == (char)c) return (char *)s; if (!*s) return 0; } }
int abs(int x) { return x < 0 ? -x : x; }
int atoi(const char *s) { int n = 0, neg = 0; if (*s == '-') { neg = 1; s++; } while (*s >= '0' && *s <= '9') n = n * 10 + (*s++ - '0'); return neg ? -n : n; }
int tolower(int c) { return c >= 'A' && c <= 'Z' ? c + 32 : c; }
int toupper(int c) { return c >= 'a' && c <= 'z' ? c - 32 : c; }
int isdigit(int c) { return c >= '0' && c <= '9'; }
int isspace(int c) { return c == ' ' || (c >= 9 && c <= 13); }

/* ---- stdio: nothing is ever printed or read; sprintf formats just what LAME needs (%s %d %lu) ---- */
typedef struct _FILE FILE;
FILE *stdin = 0, *stdout = 0, *stderr = 0;
int printf(const char *f, ...) { (void)f; return 0; }
int fprintf(FILE *s, const char *f, ...) { (void)s; (void)f; return 0; }
int vfprintf(FILE *s, const char *f, va_list a) { (void)s; (void)f; (void)a; return 0; }
int fseek(FILE *s, long o, int w) { (void)s; (void)o; (void)w; return -1; }
size_t fread(void *p, size_t a, size_t b, FILE *s) { (void)p; (void)a; (void)b; (void)s; return 0; }
size_t fwrite(const void *p, size_t a, size_t b, FILE *s) { (void)p; (void)a; (void)b; (void)s; return 0; }
int fputs(const char *p, FILE *s) { (void)p; (void)s; return 0; }
static char *put_u(char *o, unsigned long v) { char t[24]; int n = 0; do { t[n++] = '0' + v % 10; v /= 10; } while (v); while (n) *o++ = t[--n]; return o; }
int sprintf(char *o, const char *f, ...) {
  va_list ap; va_start(ap, f); char *start = o;
  while (*f) {
    if (*f != '%') { *o++ = *f++; continue; }
    f++;
    if (*f == 'l') f++;
    if (*f == 's') { const char *s = va_arg(ap, const char *); while (*s) *o++ = *s++; }
    else if (*f == 'd' || *f == 'i') { int v = va_arg(ap, int); if (v < 0) { *o++ = '-'; v = -v; } o = put_u(o, (unsigned long)v); }
    else if (*f == 'u') { o = put_u(o, va_arg(ap, unsigned long)); }
    else if (*f == '%') *o++ = '%';
    f++;
  }
  *o = 0; va_end(ap); return (int)(o - start);
}

/* ---- math ---- */
extern double js_sin(double), js_cos(double), js_tan(double), js_atan(double), js_atan2(double, double), js_exp(double), js_log(double), js_log10(double), js_pow(double, double);
double sin(double x) { return js_sin(x); }
double cos(double x) { return js_cos(x); }
double tan(double x) { return js_tan(x); }
double atan(double x) { return js_atan(x); }
double atan2(double y, double x) { return js_atan2(y, x); }
double exp(double x) { return js_exp(x); }
double log(double x) { return js_log(x); }
double log10(double x) { return js_log10(x); }
double pow(double x, double y) { return js_pow(x, y); }
double sqrt(double x) { return __builtin_sqrt(x); }
double floor(double x) { return __builtin_floor(x); }
double ceil(double x) { return __builtin_ceil(x); }
double fabs(double x) { return __builtin_fabs(x); }
double fmod(double x, double y) { return x - y * __builtin_trunc(x / y); }
float sinf(float x) { return (float)js_sin(x); }
float cosf(float x) { return (float)js_cos(x); }
float sqrtf(float x) { return __builtin_sqrtf(x); }
float fabsf(float x) { return __builtin_fabsf(x); }
float floorf(float x) { return __builtin_floorf(x); }
float powf(float x, float y) { return (float)js_pow(x, y); }
float logf(float x) { return (float)js_log(x); }
float expf(float x) { return (float)js_exp(x); }

void exit(int c) { (void)c; __builtin_trap(); }
int fflush(FILE *s) { (void)s; return 0; }
float log10f(float x) { return (float)js_log10(x); }
void qsort(void *base, size_t n, size_t sz, int (*cmp)(const void *, const void *)) {
  /* shell sort, swapping bytewise: only used on tiny arrays */
  u8 *a = base;
  for (size_t gap = n / 2; gap > 0; gap /= 2)
    for (size_t i = gap; i < n; i++)
      for (size_t j = i; j >= gap && cmp(a + (j - gap) * sz, a + j * sz) > 0; j -= gap) {
        u8 *p = a + (j - gap) * sz, *q = a + j * sz;
        for (size_t k = 0; k < sz; k++) { u8 t = p[k]; p[k] = q[k]; q[k] = t; }
      }
}
