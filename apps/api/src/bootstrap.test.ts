/** Unexpected (non-HTTP) failures must leave an operator-readable trace without echoing request data. */
import { describe, expect, it, vi } from 'vitest';
import { Logger, BadRequestException, type ArgumentsHost } from '@nestjs/common';
import { ProblemFilter } from './bootstrap';

function host(path: string) {
  const response = {
    status: vi.fn().mockReturnThis(),
    type: vi.fn().mockReturnThis(),
    json: vi.fn(),
  };
  const ctx = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => ({ path, method: 'POST', body: { phone: '0900000001' } }),
    }),
  } as unknown as ArgumentsHost;
  return { ctx, response };
}

describe('ProblemFilter', () => {
  it('logs the error class and message for 500s, never the request body', () => {
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    const { ctx, response } = host('/api/v1/auth/phone/request');
    new ProblemFilter().catch(new TypeError('x is not a function'), ctx);
    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json.mock.calls[0]?.[0]).toMatchObject({
      status: 500,
      detail: 'Unexpected error',
    });
    expect(error).toHaveBeenCalledTimes(1);
    const line = String(error.mock.calls[0]?.[0]);
    expect(line).toContain('TypeError');
    expect(line).toContain('x is not a function');
    expect(line).toContain('POST /api/v1/auth/phone/request');
    expect(line).not.toContain('0900000001');
    error.mockRestore();
  });
  it('stays quiet for expected client errors', () => {
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    const { ctx, response } = host('/api/v1/x');
    new ProblemFilter().catch(new BadRequestException('Thiếu dữ liệu'), ctx);
    expect(response.status).toHaveBeenCalledWith(400);
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });
});
