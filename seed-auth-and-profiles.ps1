# =========================
# CrewClock Seeder (Auth + Profiles + Projects + Time Entries)
# Run in PowerShell (NOT Supabase SQL editor)
#
# Requires env vars:
#   $env:SUPABASE_URL="https://xxxx.supabase.co"
#   $env:SUPABASE_SERVICE_ROLE_KEY="your_service_role_key"
#   $env:CREWCLOCK_COMPANY_ID="38f87a76-3c71-462f-bf5a-d74c95fbd115"
#   $env:CREWCLOCK_ACCOUNT_ID="38f87a76-3c71-462f-bf5a-d74c95fbd115"
#
# Learned schema constraints:
#   profiles.role enum: worker | manager | admin
#   profiles.phone must be E.164
#   projects.address exists (not address1)
#   projects.lat and projects.lng are NOT NULL
#   projects.status is enum (expects "active"/"archived" unless your enum differs)
# =========================

$ErrorActionPreference = "Stop"

# ---------- Config ----------
$ADMIN_EMAIL = "ggodo@oakland.edu"
$DefaultPassword = "TempPass!2345"
$EmployeePasscode = "123456"$DefaultGeoRadiusM = 300

# ---------- Env ----------
$SUPABASE_URL = $env:SUPABASE_URL
$SERVICE_ROLE = $env:SUPABASE_SERVICE_ROLE_KEY
if (-not $SUPABASE_URL) { throw "Missing env var SUPABASE_URL" }
if (-not $SERVICE_ROLE) { throw "Missing env var SUPABASE_SERVICE_ROLE_KEY" }

$COMPANY_ID = $env:CREWCLOCK_COMPANY_ID
$ACCOUNT_ID = $env:CREWCLOCK_ACCOUNT_ID

$BUSINESS_ID = $env:CREWCLOCK_BUSINESS_ID
if (-not $BUSINESS_ID) { throw "Missing env var CREWCLOCK_BUSINESS_ID" }
if (-not $COMPANY_ID) { throw "Missing env var CREWCLOCK_COMPANY_ID" }
if (-not $ACCOUNT_ID) { throw "Missing env var CREWCLOCK_ACCOUNT_ID" }

# ---------- Seed users ----------
$Manager = @{
  email      = "manager1@crewclock.local"
  password   = $DefaultPassword
  first_name = "Morgan"
  last_name  = "Manager"
  phone      = "+12485551201"
  role       = "manager"
}


  param($m)
  ($m.Value -replace 'password\s*=\s*\$DefaultPassword', 'password=$EmployeePasscode')


# ---------- Helpers ----------
function Invoke-SupabaseAdmin {
  param(
    [Parameter(Mandatory=$true)][ValidateSet("GET","POST","PUT","PATCH","DELETE")][string]$Method,
    [Parameter(Mandatory=$true)][string]$Path,
    $Body = $null
  )
  $headers = @{
    "Authorization" = "Bearer $SERVICE_ROLE"
    "apikey"        = $SERVICE_ROLE
    "Content-Type"  = "application/json"
  }
  $uri = "$SUPABASE_URL$Path"
  if ($null -ne $Body) {
    return Invoke-RestMethod -Method $Method -Uri $uri -Headers $headers -Body ($Body | ConvertTo-Json -Depth 20)
  }
  return Invoke-RestMethod -Method $Method -Uri $uri -Headers $headers
}

function Invoke-PostgREST {
  param(
    [Parameter(Mandatory=$true)][ValidateSet("GET","POST","PATCH","DELETE")][string]$Method,
    [Parameter(Mandatory=$true)][string]$Path,
    $Body = $null,
    [hashtable]$ExtraHeaders = @{}
  )
  $headers = @{
    "Authorization" = "Bearer $SERVICE_ROLE"
    "apikey"        = $SERVICE_ROLE
    "Content-Type"  = "application/json"
  }
  foreach ($k in $ExtraHeaders.Keys) { $headers[$k] = $ExtraHeaders[$k] }

  $uri = "$SUPABASE_URL$Path"

  try {
    if ($null -ne $Body) {
      return Invoke-RestMethod -Method $Method -Uri $uri -Headers $headers -Body ($Body | ConvertTo-Json -Depth 20)
    }
    return Invoke-RestMethod -Method $Method -Uri $uri -Headers $headers
  }
  catch {
    Write-Host "`n--- PostgREST ERROR ($Method $Path) ---" -ForegroundColor Red
    if ($_.Exception.Response -and $_.Exception.Response.GetResponseStream()) {
      $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
      $respBody = $reader.ReadToEnd()
      $reader.Close()
      Write-Host $respBody
    } else {
      Write-Host $_.Exception.Message
    }
    Write-Host "--- END ERROR ---`n" -ForegroundColor Red
    throw
  }
}

function Get-AdminUserId {
  $encoded = [System.Web.HttpUtility]::UrlEncode($ADMIN_EMAIL)
  $resp = Invoke-SupabaseAdmin -Method "GET" -Path "/auth/v1/admin/users?email=$encoded"

  if ($resp.users -and $resp.users.Count -gt 0) {
    $match = $resp.users | Where-Object { $_.email -eq $ADMIN_EMAIL } | Select-Object -First 1
    if ($match) { return $match.id }
    return $resp.users[0].id
  }

  if ($resp -is [System.Collections.IEnumerable]) {
    $match = $resp | Where-Object { $_.email -eq $ADMIN_EMAIL } | Select-Object -First 1
    if ($match) { return $match.id }
    return ($resp | Select-Object -First 1).id
  }

  throw "Could not resolve admin user id for $ADMIN_EMAIL"
}

function Create-Or-Get-AuthUserId {
  param([Parameter(Mandatory=$true)][hashtable]$User)

  try {
    $encoded = [System.Web.HttpUtility]::UrlEncode($User.email)
    $found = Invoke-SupabaseAdmin -Method "GET" -Path "/auth/v1/admin/users?email=$encoded"
    $match = $null
    if ($found.users) { $match = $found.users | Where-Object { $_.email -eq $User.email } | Select-Object -First 1 }
    elseif ($found -is [System.Collections.IEnumerable]) { $match = $found | Where-Object { $_.email -eq $User.email } | Select-Object -First 1 }
    if ($match) { return $match.id }
  } catch {}

  $created = Invoke-SupabaseAdmin -Method "POST" -Path "/auth/v1/admin/users" -Body @{
    email         = $User.email
    password      = $User.password
    email_confirm = $true
    user_metadata = @{
      first_name = $User.first_name
      last_name  = $User.last_name
      phone      = $User.phone
      role       = $User.role
    }
  }
  return $created.id
}

function New-Guid { [guid]::NewGuid().ToString() }
function Get-RandomElement([object[]]$arr) { return $arr[(Get-Random -Minimum 0 -Maximum $arr.Count)] }

function Get-RandomLatLngMetroDetroit {
  # Rough bounding box around Metro Detroit
  # lat: 42.20 - 42.55
  # lng: -83.45 - -82.90
  $lat = 42.20 + (Get-Random -Minimum 0 -Maximum 3500) / 10000.0
  $lng = -83.45 + (Get-Random -Minimum 0 -Maximum 5500) / 10000.0
  return @{ lat = [double]$lat; lng = [double]$lng }
}

# ---------- Main ----------
$adminUserId = Get-AdminUserId
Write-Host "Admin user id: $adminUserId"
Write-Host "Company id: $COMPANY_ID"
Write-Host "Account id: $ACCOUNT_ID"

Write-Host "A) Creating/getting auth users..."
$managerAuthId = Create-Or-Get-AuthUserId -User $Manager
$employeeAuthIds = @()
foreach ($u in $Employees) { $employeeAuthIds += (Create-Or-Get-AuthUserId -User $u) }

Write-Host "B) Upserting public.profiles..."
$profilesPayload = @()

$profilesPayload += @{
  id = $managerAuthId
  company_id = $COMPANY_ID
  account_id = $ACCOUNT_ID
  first_name = $Manager.first_name
  last_name  = $Manager.last_name
  phone      = $Manager.phone
  role       = $Manager.role
  is_active  = $true
  onboarding_step_completed = 3
}

for ($i=0; $i -lt $Employees.Count; $i++) {
  $e = $Employees[$i]
  $profilesPayload += @{
    id = $employeeAuthIds[$i]
    company_id = $COMPANY_ID
    account_id = $ACCOUNT_ID
    first_name = $e.first_name
    last_name  = $e.last_name
    phone      = $e.phone
    role       = $e.role
    is_active  = $true
    onboarding_step_completed = 3
  }
}

Invoke-PostgREST -Method "POST" -Path "/rest/v1/profiles" -Body $profilesPayload -ExtraHeaders @{
  "Prefer" = "resolution=merge-duplicates"
} | Out-Null

Write-Host "C) Seeding projects..."
$activeSites = @(
  @{ name="Royal Oak Retail Fit-Out";     address="301 S Main St, Royal Oak, MI 48067";        lat=42.4895; lng=-83.1446 },
  @{ name="Troy Office Refresh";         address="200 W Big Beaver Rd, Troy, MI 48084";       lat=42.5630; lng=-83.1516 },
  @{ name="Birmingham Lobby Renovation"; address="555 S Old Woodward, Birmingham, MI 48009";  lat=42.5467; lng=-83.2113 },
  @{ name="Ferndale Storefront Update";  address="22700 Woodward Ave, Ferndale, MI 48220";    lat=42.4606; lng=-83.1346 },
  @{ name="Southfield HVAC Service";     address="25900 Northwestern Hwy, Southfield, MI 48075"; lat=42.4743; lng=-83.2585 },
  @{ name="Novi Warehouse Lighting";     address="44000 Grand River Ave, Novi, MI 48375";     lat=42.4798; lng=-83.4896 },
  @{ name="Pontiac Safety Inspection";   address="50 W Huron St, Pontiac, MI 48342";          lat=42.6389; lng=-83.2910 },
  @{ name="Auburn Hills Site Cleanup";   address="1500 University Dr, Auburn Hills, MI 48326"; lat=42.6703; lng=-83.2196 },
  @{ name="Sterling Heights Build-Out";  address="40111 Mound Rd, Sterling Heights, MI 48310"; lat=42.5803; lng=-83.0280 },
  @{ name="Detroit Downtown Punch List"; address="1001 Woodward Ave, Detroit, MI 48226";      lat=42.3320; lng=-83.0466 }
)

$cities = @("Detroit","Warren","Dearborn","Livonia","Westland","Farmington Hills","Madison Heights","Oak Park","Hazel Park","Clawson")
$zips   = @("48201","48226","48089","48126","48154","48150","48185","48336","48071","48067")
$dirs   = @("W","E","N","S")

$projectPayload = @()

foreach ($s in $activeSites) {
  $projectPayload += @{
    id          = (New-Guid)
    company_id  = $COMPANY_ID
    business_id = $BUSINESS_ID
    created_by  = $adminUserId
    name        = $s.name
    address     = $s.address
    lat         = [double]$s.lat
    lng         = [double]$s.lng
    geo_radius_m= $DefaultGeoRadiusM
    status      = "active"
  }
}

for ($i=1; $i -le 50; $i++) {
  $addr = ("{0} {1} Maple St, {2}, MI {3}" -f (100 + ($i*7)), ($dirs[$i % $dirs.Count]), $cities[$i % $cities.Count], $zips[$i % $zips.Count])
  $ll = Get-RandomLatLngMetroDetroit  $ll = Get-RandomLatLngMetroDetroit  $ll = Get-RandomLatLngMetroDetroit
  $projectPayload += @{
    id          = (New-Guid)
    company_id  = $COMPANY_ID
    business_id = $BUSINESS_ID
    created_by  = $adminUserId
    name        = ("Archived Site {0:000}" -f $i)
    address     = $addr
    lat         = [double]$ll.lat
    lng         = [double]$ll.lng
    geo_radius_m= $DefaultGeoRadiusM
    status      = "archived"
  }
}

Invoke-PostgREST -Method "POST" -Path "/rest/v1/projects" -Body $projectPayload -ExtraHeaders @{
  "Prefer" = "resolution=merge-duplicates"
} | Out-Null

Write-Host "D) Fetching project ids..."
$active = Invoke-PostgREST -Method "GET" -Path "/rest/v1/projects?company_id=eq.$COMPANY_ID&status=eq.active&select=id"
$arch   = Invoke-PostgREST -Method "GET" -Path "/rest/v1/projects?company_id=eq.$COMPANY_ID&status=eq.archived&select=id"

$activeIds = @($active | ForEach-Object { $_.id })
$archIds   = @($arch   | ForEach-Object { $_.id })

if ($activeIds.Count -lt 1) { throw "No active projects found after insert." }

# Build a lookup for project lat/lng (id -> {lat,lng})
$allProj = Invoke-PostgREST -Method "GET" -Path "/rest/v1/projects?company_id=eq.$COMPANY_ID&select=id,lat,lng"
$projectGeo = @{}
foreach ($p in $allProj) { $projectGeo[$p.id] = @{ lat = [double]$p.lat; lng = [double]$p.lng } }

Write-Host "E) Seeding time entries..."
$timeEntries = @()
$now = Get-Date

foreach ($empId in $employeeAuthIds) {
  for ($k=0; $k -lt 40; $k++) {
    $daysAgo = Get-Random -Minimum 0 -Maximum 90
    $baseDay = $now.Date.AddDays(-$daysAgo)

    $startHour = Get-Random -Minimum 6 -Maximum 18
    $startMin  = Get-Random -Minimum 0 -Maximum 60
    $start = $baseDay.AddHours($startHour).AddMinutes($startMin)

    $durHours = Get-Random -Minimum 2 -Maximum 10
    $durMin   = Get-Random -Minimum 0 -Maximum 30
    $end = $start.AddHours($durHours).AddMinutes($durMin)

    $useArchived = ($archIds.Count -gt 0) -and ((Get-Random -Minimum 0 -Maximum 100) -lt 25)
    $projectId = if ($useArchived) { Get-RandomElement $archIds } else { Get-RandomElement $activeIds }

    $timeEntries += @{
      id               = (New-Guid)
      company_id        = $COMPANY_ID
      business_id       = $BUSINESS_ID
      employee_id       = $empId
      project_id        = $projectId
      clock_in          = $start.ToString("o")
      clock_out         = $end.ToString("o")
      clock_in_lat      = $projectGeo[$projectId].lat
      clock_in_lng      = $projectGeo[$projectId].lng
      clock_out_lat     = $projectGeo[$projectId].lat
      clock_out_lng     = $projectGeo[$projectId].lng
    }}
}

# Batch inserts to avoid payload limits
$batchSize = 200
for ($idx=0; $idx -lt $timeEntries.Count; $idx += $batchSize) {
  $chunk = $timeEntries[$idx..([Math]::Min($idx+$batchSize-1, $timeEntries.Count-1))]
  Invoke-PostgREST -Method "POST" -Path "/rest/v1/time_entries" -Body $chunk | Out-Null
  Write-Host "   Inserted time_entries batch $([int]($idx/$batchSize)+1)"
}

Write-Host ""
Write-Host "Done."
Write-Host "Logins:"
Write-Host " - $($Manager.email) / $DefaultPassword"
foreach ($e in $Employees) { Write-Host " - $($e.email) / $DefaultPassword" }








