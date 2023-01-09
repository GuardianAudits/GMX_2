import { hashString } from "./hash";

export async function grantRole(roleStore, account, role) {
  await roleStore.grantRole(account, hashString(role));
}

export async function revokeRole(roleStore, account, role) {
  await roleStore.revokeRole(account, hashString(role));
}
