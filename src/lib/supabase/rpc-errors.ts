type PostgrestErrorLike = {
  message: string;
  details?: string | null;
  hint?: string | null;
  code?: string | null;
};

function quoteSqlLiteral(input: string): string {
  return input.replace(/'/g, "''");
}

export function serializePostgrestError(error: PostgrestErrorLike) {
  return {
    error: error.message,
    details: error.details ?? null,
    hint: error.hint ?? null,
    code: error.code ?? null,
  };
}

export function buildRpcErrorPayload(
  functionName: string,
  argNames: string[],
  error: PostgrestErrorLike
) {
  const base = serializePostgrestError(error);
  if (error.code !== "PGRST202") {
    return base;
  }

  const escapedName = quoteSqlLiteral(functionName);
  const verificationSql = [
    "select p.proname, pg_get_function_identity_arguments(p.oid) as args",
    "from pg_proc p join pg_namespace n on n.oid = p.pronamespace",
    `where n.nspname = 'public' and p.proname = '${escapedName}';`,
  ].join("\n");

  return {
    ...base,
    next_steps:
      "RPC missing from PostgREST schema cache or signature mismatch. Verify function signature and reload cache.",
    function_name: functionName,
    expected_arg_names: argNames,
    verification_sql: verificationSql,
    reload_schema_sql: "NOTIFY pgrst, 'reload schema';",
  };
}
