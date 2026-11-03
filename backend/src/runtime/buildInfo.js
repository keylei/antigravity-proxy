/**
 * 构建信息
 * 这些值在 esbuild 构建时通过 define 注入
 */

/* global AGP_BUILD_VERSION, AGP_BUILD_TARGET */

const rawVersion = typeof AGP_BUILD_VERSION !== 'undefined' ? AGP_BUILD_VERSION : '';
const rawTarget = typeof AGP_BUILD_TARGET !== 'undefined' ? AGP_BUILD_TARGET : '';

export const BUILD_VERSION =
    typeof rawVersion === 'string' && rawVersion.trim() ? rawVersion.trim() : 'dev';

export const BUILD_TARGET =
    typeof rawTarget === 'string' && rawTarget.trim() ? rawTarget.trim() : `${process.platform}-${process.arch}`;
