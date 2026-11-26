export type ApiSuccess<T> = { data: T; meta?: { requestId: string } };
export type ApiFailure = { error: { code: string; message: string; details?: unknown }; meta?: { requestId: string } };
export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;
export type CompanySummary = { id: string; name: string; legalName?: string; gstin?: string; active: boolean };
export type UserSummary = { id: string; displayName: string; email: string };
export type HealthResponse = { status: "ok"; service: "stockerp-api"; timestamp: string };
export type PageQuery = { page: number; pageSize: 10 | 25 | 50 | 100; search?: string; sortBy?: string; sortOrder?: "asc" | "desc" };
