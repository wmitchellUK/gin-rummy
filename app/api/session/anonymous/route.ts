import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { routeError } from "@/src/server/http";

export async function POST() {
  try {
    const supabase = await createClient();
    const { data: existing } = await supabase.auth.getUser();
    if (existing.user) return NextResponse.json({ userId: existing.user.id });
    const { data, error } = await supabase.auth.signInAnonymously();
    if (error || !data.user) return NextResponse.json({ error: { code: "ANONYMOUS_SIGN_IN_FAILED" } }, { status: 401 });
    return NextResponse.json({ userId: data.user.id }, { status: 201 });
  } catch (error) { return routeError(error); }
}
