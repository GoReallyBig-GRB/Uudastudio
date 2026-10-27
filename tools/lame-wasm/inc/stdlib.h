#pragma once
#include <stddef.h>
void *malloc(size_t);
void *calloc(size_t, size_t);
void *realloc(void *, size_t);
void free(void *);
int abs(int);
void qsort(void *, size_t, size_t, int (*)(const void *, const void *));
void exit(int);
int atoi(const char *);
