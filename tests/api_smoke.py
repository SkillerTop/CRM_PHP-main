from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from http.cookiejar import CookieJar


BASE_URL = os.environ.get("CRM_TEST_BASE_URL", "http://127.0.0.1:8088/api").rstrip("/")
ADMIN_EMAIL = os.environ.get("CRM_TEST_ADMIN_EMAIL", "admin@example.com")
ADMIN_PASSWORD = os.environ.get("CRM_TEST_ADMIN_PASSWORD", "AdminTest123!")


class Client:
    def __init__(self) -> None:
        self.jar = CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
        self.csrf = ""

    def request(self, method: str, path: str, payload=None, expected=(200,)):
        headers = {"Accept": "application/json"}
        data = None
        if payload is not None:
            data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            headers["Content-Type"] = "application/json"
        if method not in {"GET", "HEAD", "OPTIONS"} and self.csrf:
            headers["X-CSRF-Token"] = self.csrf
        request = urllib.request.Request(BASE_URL + path, data=data, headers=headers, method=method)
        try:
            with self.opener.open(request, timeout=10) as response:
                status = response.status
                content_type = response.headers.get("Content-Type", "")
                raw = response.read()
        except urllib.error.HTTPError as error:
            status = error.code
            content_type = error.headers.get("Content-Type", "")
            raw = error.read()
        if status not in expected:
            raise AssertionError(f"{method} {path}: expected {expected}, got {status}: {raw.decode('utf-8', 'replace')}")
        if "application/json" in content_type:
            return status, json.loads(raw.decode("utf-8"))
        return status, raw

    def login(self, email: str, password: str) -> dict:
        _, body = self.request("POST", "/auth/login", {"email": email, "password": password})
        self.csrf = body["data"]["csrf_token"]
        return body["data"]["user"]

    def upload(self, path: str, filename: str, content: bytes, expected=(201,)):
        boundary = "----crm-smoke-" + str(time.time_ns())
        body = (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'
            "Content-Type: application/octet-stream\r\n\r\n"
        ).encode("ascii") + content + f"\r\n--{boundary}--\r\n".encode("ascii")
        headers = {
            "Accept": "application/json",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "X-CSRF-Token": self.csrf,
        }
        request = urllib.request.Request(BASE_URL + path, data=body, headers=headers, method="POST")
        try:
            with self.opener.open(request, timeout=10) as response:
                status = response.status
                raw = response.read()
        except urllib.error.HTTPError as error:
            status = error.code
            raw = error.read()
        if status not in expected:
            raise AssertionError(f"upload {path}: expected {expected}, got {status}: {raw.decode('utf-8', 'replace')}")
        return status, json.loads(raw.decode("utf-8"))


def lookup_id(data: dict, lookup_type: str, key: str) -> int:
    return next(item["id"] for item in data[lookup_type] if item["key"] == key)


def main() -> None:
    admin = Client()
    admin.request("GET", "/health")
    admin_user = admin.login(ADMIN_EMAIL, ADMIN_PASSWORD)
    assert admin_user["role"] == "admin"
    admin_password_changed = False
    active_admin_password = ADMIN_PASSWORD
    if admin_user["must_change_password"]:
        active_admin_password = "Smoke-Admin-Changed-123!"
        admin.request(
            "PUT",
            "/profile/password",
            {
                "current_password": ADMIN_PASSWORD,
                "password": active_admin_password,
                "password_confirmation": active_admin_password,
            },
        )
        admin_password_changed = True

    _, settings_body = admin.request("GET", "/settings")
    settings = settings_body["data"]
    assert settings["system_notification_email"]
    _, saved_settings_body = admin.request("PUT", "/settings", settings)
    assert saved_settings_body["data"] == settings
    without_domains = settings | {"registration_allowed_domains": []}
    _, without_domains_body = admin.request("PUT", "/settings", without_domains)
    assert without_domains_body["data"]["registration_allowed_domains"] == []
    with_default_notification_email = settings | {"system_notification_email": ""}
    _, default_notification_body = admin.request("PUT", "/settings", with_default_notification_email)
    assert default_notification_body["data"]["system_notification_email"]
    admin.request("PUT", "/settings", settings)

    _, body = admin.request("GET", "/lookups")
    lookups = body["data"]
    company_type = lookup_id(lookups, "company_type", "shipyard")
    client_status = lookup_id(lookups, "client_status", "new_lead")
    contact_source = lookup_id(lookups, "contact_source", "exhibition")
    manager = lookup_id(lookups, "cjn_manager", "vitalii_vyshnevskyi")
    task_status = lookup_id(lookups, "task_status", "not_started")
    task_completed = lookup_id(lookups, "task_status", "completed")
    outcome = lookup_id(lookups, "outcome_status", "neutral")
    reminder = lookup_id(lookups, "reminder_lead_time", "one_day")

    custom_type_value = f"Smoke Type {int(time.time() * 1000)}"
    _, custom_type_body = admin.request(
        "POST",
        "/lookups/company_type",
        {"key": f"smoke_type_{int(time.time() * 1000)}", "value": custom_type_value},
        (201,),
    )
    custom_type = custom_type_body["data"]

    suffix = str(int(time.time() * 1000))
    registration_email = f"registration.{suffix}@example.com"
    anonymous = Client()
    registration_status, registration_body = anonymous.request(
        "POST",
        "/auth/register",
        {
            "full_name": "Smoke Registration",
            "email": registration_email,
            "password": "Registration123!",
            "password_confirmation": "Registration123!",
            "role": "admin",
        },
        (202,),
    )
    duplicate_status, duplicate_body = anonymous.request(
        "POST",
        "/auth/register",
        {
            "full_name": "Different Name",
            "email": registration_email,
            "password": "DifferentPassword123!",
            "password_confirmation": "DifferentPassword123!",
        },
        (202,),
    )
    assert duplicate_status == registration_status
    assert duplicate_body == registration_body
    _, forgot_known = anonymous.request("POST", "/auth/forgot-password", {"email": registration_email})
    _, forgot_unknown = anonymous.request("POST", "/auth/forgot-password", {"email": f"missing.{suffix}@example.com"})
    assert forgot_known == forgot_unknown
    anonymous.request("POST", "/auth/login", {"email": registration_email, "password": "Registration123!"}, (401,))
    _, users_body = admin.request("GET", "/users")
    registration = next(user for user in users_body["data"] if user["email"] == registration_email)
    assert registration["role"] == "readonly" and registration["pending_approval"] and not registration["is_active"]
    _, approved_body = admin.request(
        "POST",
        f"/users/{registration['id']}/approve",
        {"role": "readonly"},
    )
    approved = approved_body["data"]
    assert approved["role"] == "readonly" and approved["is_active"] and not approved["pending_approval"]
    approved_client = Client()
    approved_client.login(registration_email, "Registration123!")
    _, approval_audit = admin.request("GET", "/audit?entity_type=User&action=FIELD%20CHANGE&page=1")
    approval_fields = {
        event["field"]
        for event in approval_audit["data"]
        if event["entity_id"] == registration["id"]
    }
    assert {"Active", "Registration"}.issubset(approval_fields)
    _, user_log = admin.request("GET", f"/users/{registration['id']}/log")
    assert any(event["action"] == "USER REGISTERED" for event in user_log["data"])
    admin.request("GET", f"/lookups/task_status/{task_status}/log")

    invite_email = f"invite.{suffix}@example.com"
    _, invite_body = admin.request(
        "POST",
        "/users",
        {
            "full_name": "Smoke Invite",
            "email": invite_email,
            "role": "editor",
            "is_active": True,
            "delivery": "invite",
        },
        (201,),
    )
    assert invite_body["data"]["role"] == "editor"
    Client().request("POST", "/auth/login", {"email": invite_email, "password": "NoPassword123!"}, (401,))

    company_payload = {
        "name": f"Smoke Marine {suffix}",
        "type_id": company_type,
        "country": "Україна",
        "city": "Київ",
        "status_id": client_status,
        "manager_id": manager,
        "website": "example.com",
        "description": "Кирилиця · Höflich · €",
    }
    _, body = admin.request("POST", "/companies", company_payload, (201,))
    company = body["data"]
    assert company["website"].startswith("https://")

    _, duplicate_company = admin.request("POST", "/companies", company_payload, (409,))
    assert duplicate_company["error"]["code"] == "possible_duplicate"
    _, company_list = admin.request(
        "GET",
        f"/companies?type={company_type}&status={client_status}&q={urllib.parse.quote(suffix)}&sort=name&dir=asc&page=1",
    )
    assert company_list["meta"]["per_page"] == 50
    assert any(row["id"] == company["id"] for row in company_list["data"])
    _, updated_company_body = admin.request(
        "PUT",
        f"/companies/{company['id']}",
        company_payload | {"city": "Updated City", "updated_at": company["updated_at"]},
    )
    company = updated_company_body["data"]
    assert company["city"] == "Updated City"

    _, stable_company_body = admin.request(
        "POST",
        "/companies",
        company_payload | {"name": f"Stable Lookup {suffix}", "type_id": custom_type["id"]},
        (201,),
    )
    stable_company = stable_company_body["data"]
    renamed_type = custom_type_value + " Renamed"
    admin.request(
        "PUT",
        f"/lookups/company_type/{custom_type['id']}",
        {"value": renamed_type, "updated_at": custom_type["updated_at"]},
    )
    _, stable_company_after = admin.request("GET", f"/companies/{stable_company['id']}")
    assert stable_company_after["data"]["type"] == renamed_type
    _, lookup_log = admin.request("GET", f"/lookups/company_type/{custom_type['id']}/log")
    assert any(event["value_from"] == custom_type_value and event["value_to"] == renamed_type for event in lookup_log["data"])

    contact_payload = {
        "company_id": company["id"],
        "first_name": "Іван",
        "last_name": "Тестовий",
        "email": f"smoke.{suffix}@example.com",
        "phone": "+380 (44) 123-45-67",
        "source_id": contact_source,
        "source_detail": "SMM Hamburg 2026",
        "initiated_by_id": manager,
        "manager_id": manager,
    }
    _, body = admin.request("POST", "/contacts", contact_payload, (201,))
    contact = body["data"]
    _, contact_list = admin.request(
        "GET",
        f"/contacts?company={company['id']}&source={contact_source}&has_linkedin=no&q={urllib.parse.quote(contact_payload['first_name'])}",
    )
    assert contact_list["meta"]["total"] >= 1
    assert any(row["id"] == contact["id"] for row in contact_list["data"])
    _, cleared_contact_body = admin.request(
        "PUT",
        f"/contacts/{contact['id']}",
        contact_payload | {
            "source_id": None,
            "source_detail": "must be cleared",
            "referred_by": "must be cleared",
            "updated_at": contact["updated_at"],
        },
    )
    contact = cleared_contact_body["data"]
    assert contact["source_id"] is None
    assert contact["source_detail"] is None and contact["referred_by"] is None

    task_payload = {
        "company_id": company["id"],
        "name": "Smoke follow-up",
        "contact_date": "2026-08-06",
        "manager_id": manager,
        "contact_person_id": contact["id"],
        "description": "Initial description",
        "status_id": task_status,
        "priority": "High",
        "outcome_status_id": outcome,
        "outcome_notes": "Initial outcome",
        "deadline": "2027-08-06T17:00:00+03:00",
        "reminder_lead_ids": [reminder],
    }
    _, invalid_deadline = admin.request(
        "POST",
        "/tasks",
        task_payload | {"name": "Date-only deadline", "deadline": "2027-08-06"},
        (400,),
    )
    assert invalid_deadline["error"]["code"] == "validation_error"
    _, body = admin.request("POST", "/tasks", task_payload, (201,))
    task = body["data"]
    stale_updated_at = task["updated_at"]

    task_payload.update(
        {
            "contact_date": "2026-08-07",
            "description": "Changed description",
            "outcome_notes": "Changed outcome",
            "updated_at": stale_updated_at,
        }
    )
    _, body = admin.request("PUT", f"/tasks/{task['id']}", task_payload)
    task = body["data"]
    _, stale_body = admin.request("PUT", f"/tasks/{task['id']}", task_payload, (409,))
    assert stale_body["error"]["code"] == "edit_conflict"

    _, body = admin.request("GET", f"/companies/{company['id']}")
    company = body["data"]
    assert company["last_contact_date"] == "2026-08-07"

    _, body = admin.request("GET", f"/tasks/{task['id']}/log")
    fields = {row["field_name"] for row in body["data"]}
    assert {"Contact Date", "Description", "Outcome notes"}.issubset(fields)
    contact_date_event = next(row for row in body["data"] if row["field_name"] == "Contact Date")
    _, matching_audit = admin.request("GET", "/audit?entity_type=Task&action=FIELD%20CHANGE&per_page=100")
    assert any(event["id"] == contact_date_event["id"] for event in matching_audit["data"])

    _, company_log = admin.request("GET", f"/companies/{company['id']}/log")
    assert any(event["field_name"] == "Last Contact Date" for event in company_log["data"])

    transfer_payload = task_payload | {
        "company_id": stable_company["id"],
        "contact_person_id": None,
        "updated_at": task["updated_at"],
    }
    _, transferred_body = admin.request("PUT", f"/tasks/{task['id']}", transfer_payload)
    transferred_task = transferred_body["data"]
    assert transferred_task["company_id"] == stable_company["id"]
    _, old_company_after_transfer = admin.request("GET", f"/companies/{company['id']}")
    _, new_company_after_transfer = admin.request("GET", f"/companies/{stable_company['id']}")
    assert old_company_after_transfer["data"]["last_contact_date"] is None
    assert new_company_after_transfer["data"]["last_contact_date"] == "2026-08-07"
    _, transfer_log = admin.request("GET", f"/tasks/{task['id']}/log")
    assert any(event["field_name"] == "Company" for event in transfer_log["data"])

    transfer_back_payload = task_payload | {
        "company_id": company["id"],
        "contact_person_id": contact["id"],
        "updated_at": transferred_task["updated_at"],
    }
    _, transferred_back_body = admin.request("PUT", f"/tasks/{task['id']}", transfer_back_payload)
    task = transferred_back_body["data"]

    default_date_payload = task_payload | {
        "name": "Default contact date",
        "contact_person_id": None,
        "deadline": None,
        "reminder_lead_ids": [],
    }
    default_date_payload.pop("contact_date")
    default_date_payload.pop("updated_at")
    _, default_date_body = admin.request("POST", "/tasks", default_date_payload, (201,))
    default_task = default_date_body["data"]
    assert len(default_task["contact_date"]) == 10

    _, ics = admin.request("GET", f"/tasks/{task['id']}/reminder.ics")
    assert b"BEGIN:VCALENDAR" in ics and b"BEGIN:VEVENT" in ics

    comment_status, body = admin.request("POST", f"/tasks/{task['id']}/comments", {"text": "Smoke comment"}, (201,))
    assert comment_status == 201 and body["data"]["id"] > 0
    _, attachment_body = admin.upload(
        f"/tasks/{task['id']}/attachments",
        "smoke.pdf",
        b"%PDF-1.4\n% smoke attachment\n",
    )
    attachment = attachment_body["data"]
    _, attachment_download = admin.request(
        "GET",
        f"/tasks/{task['id']}/attachments/{attachment['id']}",
    )
    assert attachment_download.startswith(b"%PDF-1.4")
    admin.request("DELETE", f"/tasks/{task['id']}/attachments/{attachment['id']}", expected=(204,))
    admin.request("GET", f"/tasks/{task['id']}/attachments/{attachment['id']}", expected=(404,))

    _, company_tasks = admin.request("GET", f"/companies/{company['id']}/tasks")
    company_task = next(row for row in company_tasks["data"] if row["id"] == task["id"])
    assert company_task["comment_count"] >= 1 and company_task["change_count"] >= 1
    assert isinstance(company_task["reminder_possible"], bool)

    _, dashboard = admin.request("GET", "/dashboard")
    assert dashboard["data"]["kpi"]["companies"] >= 1
    assert any(row["status_id"] == client_status for row in dashboard["data"]["funnel"])
    assert any(row["manager_id"] == manager for row in dashboard["data"]["manager_activity"])
    _, pipeline = admin.request("GET", "/pipeline")
    assert any(
        card["id"] == company["id"]
        for column in pipeline["data"]
        for card in column["companies"]
    )
    search_term = "\u041a\u0438\u0440\u0438\u043b\u0438\u0446\u044f"
    _, search = admin.request("GET", "/search?q=" + urllib.parse.quote(search_term))
    assert any(row["id"] == company["id"] for row in search["data"]["companies"])

    readonly_email = f"readonly.{suffix}@example.com"
    _, body = admin.request(
        "POST",
        "/users",
        {
            "full_name": "Smoke Readonly",
            "email": readonly_email,
            "role": "readonly",
            "is_active": True,
            "delivery": "temporary_password",
            "temporary_password": "Readonly123!",
        },
        (201,),
    )
    readonly_user = body["data"]

    viewer = Client()
    viewer_user = viewer.login(readonly_email, "Readonly123!")
    assert viewer_user["must_change_password"]
    _, forced_change = viewer.request("GET", "/companies", expected=(403,))
    assert forced_change["error"]["code"] == "password_change_required"
    _, unchanged_password = viewer.request(
        "PUT",
        "/profile/password",
        {
            "current_password": "Readonly123!",
            "password": "Readonly123!",
            "password_confirmation": "Readonly123!",
        },
        (400,),
    )
    assert unchanged_password["error"]["code"] == "password_unchanged"
    viewer.request("GET", "/companies", expected=(403,))
    viewer.request(
        "PUT",
        "/profile/password",
        {
            "current_password": "Readonly123!",
            "password": "ReadonlyChanged123!",
            "password_confirmation": "ReadonlyChanged123!",
        },
    )
    viewer.request("GET", "/companies")
    changed_readonly_email = f"readonly.changed.{suffix}@example.com"
    viewer.request(
        "PUT",
        "/profile",
        {
            "full_name": "Smoke Readonly Changed",
            "email": changed_readonly_email,
            "current_password": "ReadonlyChanged123!",
            "role": "admin",
            "is_active": False,
        },
    )
    _, changed_profile = viewer.request("GET", "/auth/me")
    assert changed_profile["data"]["user"]["email"] == changed_readonly_email
    assert changed_profile["data"]["user"]["role"] == "readonly"
    assert changed_profile["data"]["user"]["is_active"]
    viewer.request("POST", "/companies", company_payload | {"name": f"Forbidden {suffix}"}, (403,))
    viewer.request("GET", "/users", expected=(403,))
    viewer.request("GET", f"/users/{readonly_user['id']}/log", expected=(403,))
    viewer.request("GET", "/settings", expected=(403,))

    worker_email = f"worker.{suffix}@example.com"
    _, worker_body = admin.request(
        "POST",
        "/users",
        {
            "full_name": "Smoke Worker",
            "email": worker_email,
            "role": "manager",
            "is_active": True,
            "delivery": "temporary_password",
            "temporary_password": "Worker123!",
        },
        (201,),
    )
    worker_user = worker_body["data"]
    worker = Client()
    worker.login(worker_email, "Worker123!")
    worker.request(
        "PUT",
        "/profile/password",
        {
            "current_password": "Worker123!",
            "password": "WorkerChanged123!",
            "password_confirmation": "WorkerChanged123!",
        },
    )
    worker.request(
        "POST",
        "/companies",
        company_payload | {"name": f"Manager Write {suffix}"},
        (201,),
    )
    _, users_after_worker_password = admin.request("GET", "/users")
    worker_user = next(user for user in users_after_worker_password["data"] if user["id"] == worker_user["id"])
    _, editor_body = admin.request(
        "PUT",
        f"/users/{worker_user['id']}",
        {
            "full_name": worker_user["full_name"],
            "role": "editor",
            "is_active": True,
            "updated_at": worker_user["updated_at"],
        },
    )
    worker_user = editor_body["data"]
    worker.request(
        "POST",
        "/companies",
        company_payload | {"name": f"Editor Write {suffix}"},
        (201,),
    )
    admin.request(
        "PUT",
        f"/users/{worker_user['id']}",
        {
            "full_name": worker_user["full_name"],
            "role": "readonly",
            "is_active": True,
            "updated_at": worker_user["updated_at"],
        },
    )
    worker.request(
        "POST",
        "/companies",
        company_payload | {"name": f"Role Changed Forbidden {suffix}"},
        (403,),
    )
    admin.request(
        "POST",
        f"/users/{worker_user['id']}/reset-password",
        {"delivery": "temporary_password", "temporary_password": "WorkerReset123!"},
    )
    worker.request("GET", "/companies", expected=(401,))
    reset_worker = Client()
    reset_worker_user = reset_worker.login(worker_email, "WorkerReset123!")
    assert reset_worker_user["must_change_password"]

    _, current_users = admin.request("GET", "/users")
    current_admin = next(user for user in current_users["data"] if user["id"] == admin_user["id"])
    _, last_admin_body = admin.request(
        "PUT",
        f"/users/{admin_user['id']}",
        {
            "full_name": admin_user["full_name"],
            "role": "editor",
            "is_active": True,
            "updated_at": current_admin["updated_at"],
        },
        (409,),
    )
    assert last_admin_body["error"]["code"] == "last_active_admin"

    _, current_company = admin.request("GET", f"/companies/{company['id']}")
    _, open_tasks_body = admin.request(
        "POST",
        f"/companies/{company['id']}/archive",
        {"archived": True, "updated_at": current_company["data"]["updated_at"]},
        (409,),
    )
    assert open_tasks_body["error"]["code"] == "company_has_open_tasks"

    task_payload.update({"status_id": task_completed, "updated_at": task["updated_at"]})
    _, body = admin.request("PUT", f"/tasks/{task['id']}", task_payload)
    task = body["data"]

    _, body = admin.request("GET", "/audit?entity_type=Task&action=FIELD%20CHANGE&page=1")
    assert any(event["entity_id"] == task["id"] and event["field"] == "Contact Date" for event in body["data"])

    _, archived_default_body = admin.request(
        "POST",
        f"/tasks/{default_task['id']}/archive",
        {"archived": True, "updated_at": default_task["updated_at"]},
    )
    archived_default = archived_default_body["data"]
    _, after_task_archive_company = admin.request("GET", f"/companies/{company['id']}")
    assert after_task_archive_company["data"]["last_contact_date"] == task["contact_date"]
    admin.request(
        "POST",
        f"/tasks/{default_task['id']}/archive",
        {"archived": False, "updated_at": archived_default["updated_at"]},
    )

    admin.request(
        "POST",
        f"/contacts/{contact['id']}/archive",
        {"archived": True, "updated_at": contact["updated_at"]},
    )
    admin.request(
        "POST",
        "/contacts",
        contact_payload | {"first_name": "Archived duplicate"},
        (409,),
    )
    _, archived_contact_search = admin.request(
        "GET",
        "/search?q=" + urllib.parse.quote(contact_payload["email"]),
    )
    assert not any(row["id"] == contact["id"] for row in archived_contact_search["data"]["contacts"])

    _, stable_company_current = admin.request("GET", f"/companies/{stable_company['id']}")
    admin.request(
        "POST",
        f"/companies/{stable_company['id']}/archive",
        {"archived": True, "updated_at": stable_company_current["data"]["updated_at"]},
    )
    _, companies_after_archive = admin.request("GET", "/companies?per_page=100")
    assert not any(row["id"] == stable_company["id"] for row in companies_after_archive["data"])

    _, audit_csv = admin.request("GET", "/audit?format=csv")
    assert audit_csv.startswith(b"\xef\xbb\xbfTimestamp,Actor,Action")

    _, catchup_body = admin.request(
        "POST",
        "/tasks",
        task_payload | {
            "name": f"Catch-up reminder {suffix}",
            "contact_person_id": None,
            "status_id": task_status,
            "deadline": "2027-12-31T12:00:00Z",
            "updated_at": None,
        },
        (201,),
    )
    catchup_task = catchup_body["data"]

    if admin_password_changed:
        admin.request(
            "PUT",
            "/profile/password",
            {
                "current_password": active_admin_password,
                "password": ADMIN_PASSWORD,
                "password_confirmation": ADMIN_PASSWORD,
            },
        )

    print(
        json.dumps(
            {
                "status": "ok",
                "company_id": company["id"],
                "contact_id": contact["id"],
                "task_id": task["id"],
                "catchup_task_id": catchup_task["id"],
                "readonly_user_id": readonly_user["id"],
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
