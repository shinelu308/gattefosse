/**
 * 统一 API 响应格式
 */

export interface ApiResponse<T = unknown> {
  code: number;
  message: string;
  data?: T;
}

/**
 * 成功响应
 */
export function success<T>(data?: T, message = 'success'): ApiResponse<T> {
  return {
    code: 0,
    message,
    data,
  };
}

/**
 * 失败响应
 */
export function fail(message: string, code = 400): ApiResponse<null> {
  return {
    code,
    message,
    data: null,
  };
}

/**
 * 分页响应
 */
export function paginate<T>(
  list: T[],
  total: number,
  page: number,
  limit: number
) {
  return {
    list,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  };
}
