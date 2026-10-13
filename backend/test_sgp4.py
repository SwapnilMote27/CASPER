from sgp4.api import Satrec
from sgp4.api import jday
from datetime import datetime, timezone


# ISS TLE
line1 = "1 25544U 98067A   19343.69339541  .00001764  00000-0  38792-4 0  9991"
line2 = "2 25544  51.6439 211.2001 0007417  17.6667  85.6398 15.50103472202482"

# Create satellite from TLE
satellite = Satrec.twoline2rv(line1, line2)

# Current UTC time
now = datetime.now(timezone.utc)

# Convert date/time to Julian Date
jd, fr = jday(
    now.year,
    now.month,
    now.day,
    now.hour,
    now.minute,
    now.second + now.microsecond / 1_000_000,
)

# SGP4 propagation
error, position, velocity = satellite.sgp4(jd, fr)

print("UTC:", now)
print("Error code:", error)
print("Position (km):", position)
print("Velocity (km/s):", velocity)