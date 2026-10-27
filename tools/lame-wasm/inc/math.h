#pragma once
double sin(double); double cos(double); double tan(double); double atan(double); double atan2(double,double);
double exp(double); double log(double); double log10(double); double pow(double,double);
double sqrt(double); double floor(double); double ceil(double); double fabs(double); double fmod(double,double);
float sinf(float); float cosf(float); float sqrtf(float); float fabsf(float); float floorf(float); float powf(float,float); float logf(float); float log10f(float); float expf(float);
#define HUGE_VAL (__builtin_huge_val())
#define M_PI 3.14159265358979323846
#define INFINITY (__builtin_inff())
#define NAN (__builtin_nanf(""))
