/**
 * Home page — redirects to dashboard.
 * @module app/page
 */
import { redirect } from "next/navigation";

export default function HomePage(): never {
  redirect("/dashboard");
}
