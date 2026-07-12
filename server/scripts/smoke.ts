import { pool, withTransaction } from "../db";

const base = process.env.API_URL ?? "http://127.0.0.1:8787/api";
const headers = {
  "content-type": "application/json",
  "x-sunscout-user-id": "00000000-0000-7000-8000-000000000001",
};
let createdBookingId: string | undefined;
let createdTripId: string | undefined;

async function request<T>(path: string, init: RequestInit = {}) {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: { ...headers, ...init.headers },
  });
  const body =
    response.status === 204 || response.status === 202
      ? undefined
      : await response.json();
  if (!response.ok) {
    throw new Error(
      `${init.method ?? "GET"} ${path}: ${response.status} ${JSON.stringify(body)}`,
    );
  }
  return body as T;
}

async function smoke() {
  const health = await request<{ status: string }>("/health");
  if (health.status !== "ok") throw new Error("Health check failed");

  const beaches = await request<{
    data: Array<{ id: string; slug: string; available: { sunbeds: number } }>;
  }>("/beaches");
  if (beaches.data.length < 6) throw new Error("Expected seeded beaches");
  const home = beaches.data.find((beach) => beach.slug === "praia-da-coelha");
  if (!home) throw new Error("Home beach missing");

  await request(`/me/saved/${home.id}`, { method: "PUT" });
  const saved = await request<{ data: string[] }>("/me/saved");
  if (!saved.data.includes(home.id))
    throw new Error("Saved beach did not persist");

  const checkIn = await request<{ data: { points_awarded: number } }>(
    "/check-ins",
    {
      method: "POST",
      body: JSON.stringify({
        beachPublicId: home.id,
        coarseLocationBucket: "smoke-test",
      }),
    },
  );
  if (checkIn.data.points_awarded !== 10)
    throw new Error("Check-in points mismatch");

  const startsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  startsAt.setUTCHours(9, 0, 0, 0);
  const booking = await request<{ data: { id: string; status: string } }>(
    "/bookings",
    {
      method: "POST",
      body: JSON.stringify({
        beachPublicId: home.id,
        startsAt: startsAt.toISOString(),
        sunbeds: 2,
        umbrellas: 1,
      }),
    },
  );
  createdBookingId = booking.data.id;
  if (booking.data.status !== "confirmed")
    throw new Error("Booking was not confirmed");

  const bookingList = await request<{ data: Array<{ public_id: string }> }>(
    "/bookings",
  );
  if (!bookingList.data.some((item) => item.public_id === booking.data.id)) {
    throw new Error("Booking did not persist");
  }

  const merchantDashboard = await request<{
    data: {
      summary: { locations: number; upcoming_bookings: number };
      inventory: Array<{
        public_id: string;
        available_count: number;
        version: number;
      }>;
      bookings: Array<{
        public_id: string;
        qr_token: string;
        status: string;
      }>;
    };
  }>("/merchant/dashboard");
  if (merchantDashboard.data.summary.locations < 1) {
    throw new Error("Merchant locations missing");
  }
  const inventoryLine = merchantDashboard.data.inventory[0];
  const inventoryUpdate = await request<{
    data: { version: number; available_count: number };
  }>(`/merchant/inventory/${inventoryLine.public_id}`, {
    method: "PATCH",
    body: JSON.stringify({
      availableCount: inventoryLine.available_count,
      version: inventoryLine.version,
    }),
  });
  if (inventoryUpdate.data.version !== inventoryLine.version + 1) {
    throw new Error("Inventory version did not advance");
  }
  const merchantBooking = merchantDashboard.data.bookings.find(
    (item) => item.public_id === booking.data.id,
  );
  if (!merchantBooking) throw new Error("Merchant booking missing");
  const redeemed = await request<{ data: { status: string } }>(
    `/merchant/bookings/${booking.data.id}/redeem`,
    {
      method: "POST",
      body: JSON.stringify({ qrToken: merchantBooking.qr_token }),
    },
  );
  if (redeemed.data.status !== "redeemed") {
    throw new Error("Merchant booking did not redeem");
  }

  const trip = await request<{ data: { public_id: string } }>("/me/trips", {
    method: "POST",
    body: JSON.stringify({
      name: "Algarve weekend",
      beachPublicIds: [home.id],
    }),
  });
  createdTripId = trip.data.public_id;
  const trips = await request<{ data: Array<{ public_id: string }> }>(
    "/me/trips",
  );
  if (!trips.data.some((item) => item.public_id === trip.data.public_id)) {
    throw new Error("Trip did not persist");
  }

  await request(`/me/saved/${home.id}`, { method: "DELETE" });
  const savedAfterDelete = await request<{ data: string[] }>("/me/saved");
  if (savedAfterDelete.data.includes(home.id))
    throw new Error("Saved beach did not delete");

  console.log(
    JSON.stringify(
      {
        status: "passed",
        beaches: beaches.data.length,
        bookingId: booking.data.id,
        tripId: trip.data.public_id,
        checkInPoints: checkIn.data.points_awarded,
      },
      null,
      2,
    ),
  );
}

async function cleanup() {
  await withTransaction(async (client) => {
    if (createdBookingId) {
      const booking = await client.query<{ id: number }>(
        "select id from booking where public_id = $1",
        [createdBookingId],
      );
      if (booking.rowCount) {
        const items = await client.query<{
          inventory_id: number;
          quantity: number;
        }>(
          "select inventory_id, quantity from booking_item where booking_id = $1",
          [booking.rows[0].id],
        );
        for (const item of items.rows) {
          await client.query(
            `update amenity_inventory
             set available_count = least(total_count, available_count + $1),
                 version = version + 1,
                 updated_at = now()
             where id = $2`,
            [item.quantity, item.inventory_id],
          );
        }
        await client.query("delete from booking where id = $1", [
          booking.rows[0].id,
        ]);
      }
    }
    if (createdTripId) {
      await client.query("delete from trip where public_id = $1", [
        createdTripId,
      ]);
    }
    await client.query(
      `delete from beach_check_in
       where coarse_location_bucket = 'smoke-test'`,
    );
  });
}

smoke()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup();
    await pool.end();
  });
