export async function redeemLaunchGrant({ config, grantId, fetchImpl = fetch }) {
  const response = await fetchImpl(config.nexusExchangeUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.nexusExchangeSecret}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ grantId })
  });

  const payload = response.status === 204 ? null : await response.json().catch(() => ({}));

  return {
    ok: response.ok,
    status: response.status,
    payload
  };
}
