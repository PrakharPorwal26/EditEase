import { clerkClient } from "@clerk/nextjs/server";
import { WebhookEvent } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { Webhook } from "svix";

import { createUser, deleteUser, updateUser } from "@/lib/actions/user.actions";
import { connectToDatabase } from "@/lib/database/mongoose";

export async function POST(req: Request) {
  try {
    await connectToDatabase();

    const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

    if (!WEBHOOK_SECRET) {
      console.error("Missing WEBHOOK_SECRET");
      throw new Error("Please add WEBHOOK_SECRET from Clerk Dashboard to .env or .env.local");
    }

    const headerPayload = headers();
    const svix_id = headerPayload.get("svix-id");
    const svix_timestamp = headerPayload.get("svix-timestamp");
    const svix_signature = headerPayload.get("svix-signature");

    if (!svix_id || !svix_timestamp || !svix_signature) {
      console.error("Missing svix headers");
      return new Response("Error occurred -- no svix headers", { status: 400 });
    }

    const payload = await req.json();
    const body = JSON.stringify(payload);
    console.log("Received payload:", payload);

    const wh = new Webhook(WEBHOOK_SECRET);

    let evt: WebhookEvent;

    try {
      evt = wh.verify(body, {
        "svix-id": svix_id,
        "svix-timestamp": svix_timestamp,
        "svix-signature": svix_signature,
      }) as WebhookEvent;
      console.log("Verified event:", evt);
    } catch (err) {
      console.error("Error verifying webhook:", err);
      return new Response("Error occurred", { status: 400 });
    }

    const { id } = evt.data;
    const eventType = evt.type;

    if (!id) {
      console.error("Missing ID in event data");
      return new Response("Error occurred -- missing ID", { status: 400 });
    }

    console.log(`Processing event: ${eventType}, User ID: ${id}`);

    switch (eventType) {
      case "user.created":
        const { email_addresses, image_url, first_name, last_name, username } = evt.data;

        const newUser = {
          clerkId: id,
          email: email_addresses[0]?.email_address || "",
          username: username || "",
          firstName: first_name || "",
          lastName: last_name || "",
          photo: image_url || "",
        };

        try {
          const createdUser = await createUser(newUser);
          console.log("User created:", createdUser);
          if (createdUser) {
            await clerkClient.users.updateUserMetadata(id, {
              publicMetadata: { userId: createdUser._id },
            });
          }
          return NextResponse.json({ message: "OK", user: createdUser });
        } catch (error) {
          console.error("Error creating user:", error);
          return new Response("Error creating user", { status: 500 });
        }

      case "user.updated":
        const updateUserParams = {
          firstName: evt.data.first_name || "",
          lastName: evt.data.last_name || "",
          username: evt.data.username || "",
          photo: evt.data.image_url || "",
        };

        try {
          const updatedUser = await updateUser(id, updateUserParams);
          console.log("User updated:", updatedUser);
          return NextResponse.json({ message: "OK", user: updatedUser });
        } catch (error) {
          console.error("Error updating user:", error);
          return new Response("Error updating user", { status: 500 });
        }

      case "user.deleted":
        try {
          const deletedUser = await deleteUser(id);
          console.log("User deleted:", deletedUser);
          return NextResponse.json({ message: "OK", user: deletedUser });
        } catch (error) {
          console.error("Error deleting user:", error);
          return new Response("Error deleting user", { status: 500 });
        }

      default:
        console.log(`Unhandled webhook event type: ${eventType}`);
        return new Response("Event received", { status: 200 });
    }
  } catch (error) {
    console.error("Error handling webhook:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
}
