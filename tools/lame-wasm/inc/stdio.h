#pragma once
#include <stddef.h>
#include <stdarg.h>
typedef struct _FILE FILE;
extern FILE *stdin, *stdout, *stderr;
#define SEEK_SET 0
#define SEEK_END 2
#define EOF (-1)
int printf(const char *, ...);
int fprintf(FILE *, const char *, ...);
int vfprintf(FILE *, const char *, va_list);
int sprintf(char *, const char *, ...);
int fseek(FILE *, long, int);
size_t fread(void *, size_t, size_t, FILE *);
size_t fwrite(const void *, size_t, size_t, FILE *);
int fputs(const char *, FILE *);
int fflush(FILE *);
