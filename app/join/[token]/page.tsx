import { InviteJoin } from "@/components/game/invite-join";

export const instant = false;

export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <InviteJoin token={token} />;
}
