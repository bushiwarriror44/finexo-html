import unittest
from io import BytesIO
from datetime import datetime, timedelta

try:
    from backend.app import app
    from backend.models import (
        ApiCredential,
        DashboardFilterPreset,
        DashboardNotification,
        KycDocument,
        KycProfile,
        MiningAccrual,
        MiningContract,
        MiningPlan,
        ReferralRule,
        SupportTicket,
        TeamApplication,
        TopUpTransaction,
        User,
        UserBalanceLedger,
        WalletAddress,
        WithdrawalRequest,
        db,
        init_all_models,
    )
    from backend.services.wallet_verifier import settle_topup
    from backend.services.mining_engine import run_daily_mining_accruals
    import backend.services.wallet_verifier as wallet_verifier_module
    import backend.routes.user_routes as user_routes_module
except ModuleNotFoundError:
    from app import app
    from models import (
        ApiCredential,
        DashboardFilterPreset,
        DashboardNotification,
        KycDocument,
        KycProfile,
        MiningAccrual,
        MiningContract,
        MiningPlan,
        ReferralRule,
        SupportTicket,
        TeamApplication,
        TopUpTransaction,
        User,
        UserBalanceLedger,
        WalletAddress,
        WithdrawalRequest,
        db,
        init_all_models,
    )
    from services.wallet_verifier import settle_topup
    from services.mining_engine import run_daily_mining_accruals
    import services.wallet_verifier as wallet_verifier_module
    import routes.user_routes as user_routes_module


class SmokeTestCase(unittest.TestCase):
    @staticmethod
    def _tx(seed: int) -> str:
        return f"{seed:064x}"

    def setUp(self):
        app.config["TESTING"] = True
        app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
        self.client = app.test_client()
        with app.app_context():
            db.drop_all()
            db.create_all()
            init_all_models()
            db.session.add(
                WalletAddress(
                    asset="USDT", network="TRX", address="TTEST123", is_active=True
                )
            )
            db.session.add(
                ApiCredential(
                    provider="tron", api_url="https://api.trongrid.io", is_active=True
                )
            )
            db.session.commit()

    def register_user(
        self, email: str, password: str = "password123", referral_code: str = ""
    ):
        payload = {
            "email": email,
            "password": password,
            "firstName": "Test",
            "lastName": "User",
            "countryCode": "US",
        }
        if referral_code:
            payload["referralCode"] = referral_code
        return self.client.post("/api/auth/register", json=payload)

    def login_user(self, email: str, password: str = "password123"):
        return self.client.post(
            "/api/auth/login", json={"email": email, "password": password}
        )

    def test_auth_and_dashboard_flow(self):
        register = self.register_user("u@test.com")
        self.assertEqual(register.status_code, 201)

        login = self.login_user("u@test.com")
        self.assertEqual(login.status_code, 200)

        me = self.client.get("/api/auth/me")
        self.assertEqual(me.status_code, 200)
        self.assertTrue(me.get_json()["authenticated"])

        wallets = self.client.get("/api/wallet/addresses")
        self.assertEqual(wallets.status_code, 200)
        wallet_id = wallets.get_json()[0]["id"]

        create_topup = self.client.post(
            "/api/wallet/topup",
            json={"walletId": wallet_id, "txHash": self._tx(1), "amount": 12.34},
        )
        self.assertEqual(create_topup.status_code, 201)

    def test_admin_api_flow(self):
        with app.app_context():
            admin = User.query.filter_by(is_admin=True).first()
            admin_id = admin.id
        with self.client.session_transaction() as sess:
            sess["admin_user_id"] = admin_id

        upsert = self.client.post(
            "/admin/api/credentials",
            json={
                "provider": "tron",
                "apiUrl": "https://api.trongrid.io",
                "apiKey": "secret",
                "isActive": True,
            },
        )
        self.assertEqual(upsert.status_code, 200)

        list_credentials = self.client.get("/admin/api/credentials")
        self.assertEqual(list_credentials.status_code, 200)
        self.assertTrue(list_credentials.get_json()[0]["apiKeyConfigured"])

        versions = self.client.get(
            f"/admin/api/credentials/{list_credentials.get_json()[0]['id']}/versions"
        )
        self.assertEqual(versions.status_code, 200)
        self.assertGreaterEqual(len(versions.get_json()), 1)

    def test_admin_credentials_update_success(self):
        with app.app_context():
            admin = User.query.filter_by(is_admin=True).first()
            admin_id = admin.id
            old_email = admin.email
        with self.client.session_transaction() as sess:
            sess["admin_user_id"] = admin_id
        response = self.client.post(
            "/admin/api/account/credentials",
            json={
                "currentPassword": "admin123",
                "newEmail": "admin.updated@test.com",
                "newPassword": "Admin1234",
            },
        )
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertTrue(payload.get("success"))
        self.assertEqual(payload.get("updatedEmail"), "admin.updated@test.com")
        self.assertTrue(payload.get("passwordUpdated"))
        self.client.get("/admin/logout")
        login_new = self.client.post(
            "/admin/login",
            data={"email": "admin.updated@test.com", "password": "Admin1234"},
            follow_redirects=False,
        )
        self.assertEqual(login_new.status_code, 302)
        with app.app_context():
            admin_row = User.query.get(admin_id)
            self.assertNotEqual(admin_row.email, old_email)

    def test_admin_credentials_update_invalid_current_password(self):
        with app.app_context():
            admin = User.query.filter_by(is_admin=True).first()
            admin_id = admin.id
        with self.client.session_transaction() as sess:
            sess["admin_user_id"] = admin_id
        response = self.client.post(
            "/admin/api/account/credentials",
            json={
                "currentPassword": "wrong-pass",
                "newEmail": "admin.fail@test.com",
                "newPassword": "Admin1234",
            },
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json().get("code"), "ADMIN_INVALID_CURRENT_PASSWORD")

    def test_admin_credentials_update_email_taken(self):
        self.register_user("occupied@test.com")
        with app.app_context():
            admin = User.query.filter_by(is_admin=True).first()
            admin_id = admin.id
        with self.client.session_transaction() as sess:
            sess["admin_user_id"] = admin_id
        response = self.client.post(
            "/admin/api/account/credentials",
            json={
                "currentPassword": "admin123",
                "newEmail": "occupied@test.com",
                "newPassword": "",
            },
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json().get("code"), "ADMIN_EMAIL_TAKEN")

    def test_admin_credentials_update_weak_password(self):
        with app.app_context():
            admin = User.query.filter_by(is_admin=True).first()
            admin_id = admin.id
        with self.client.session_transaction() as sess:
            sess["admin_user_id"] = admin_id
        response = self.client.post(
            "/admin/api/account/credentials",
            json={
                "currentPassword": "admin123",
                "newEmail": "",
                "newPassword": "short",
            },
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json().get("code"), "ADMIN_PASSWORD_POLICY_FAILED")

    def test_admin_users_list_and_detail(self):
        self.register_user("userslist@test.com")
        with app.app_context():
            admin_id = User.query.filter_by(is_admin=True).first().id
            user_id = User.query.filter_by(email="userslist@test.com").first().id
        with self.client.session_transaction() as sess:
            sess["admin_user_id"] = admin_id

        rows = self.client.get("/admin/api/users?q=userslist@test.com")
        self.assertEqual(rows.status_code, 200)
        payload = rows.get_json()
        self.assertGreaterEqual(payload["total"], 1)
        self.assertTrue(
            any(item["email"] == "userslist@test.com" for item in payload["items"])
        )

        detail = self.client.get(f"/admin/api/users/{user_id}")
        self.assertEqual(detail.status_code, 200)
        self.assertEqual(detail.get_json()["id"], user_id)
        self.assertIn("balances", detail.get_json())

    def test_manual_credit_purchase_only_for_buy_not_withdraw(self):
        self.register_user("manual@test.com")
        self.login_user("manual@test.com")
        plan_id = self.client.get("/api/user/mining/plans").get_json()[0]["id"]
        initial_buy = self.client.post(
            "/api/user/mining/contracts", json={"planId": plan_id}
        )
        self.assertEqual(initial_buy.status_code, 400)
        self.client.post("/api/auth/logout", json={})

        with app.app_context():
            admin_id = User.query.filter_by(is_admin=True).first().id
            user_id = User.query.filter_by(email="manual@test.com").first().id
        with self.client.session_transaction() as sess:
            sess["admin_user_id"] = admin_id

        manual = self.client.post(
            f"/admin/api/users/{user_id}/manual-credit",
            json={"amount": 200, "reason": "ops bonus"},
        )
        self.assertEqual(manual.status_code, 200)
        self.assertGreater(manual.get_json()["balances"]["availableUsdt"], 0)
        self.assertEqual(manual.get_json()["balances"]["withdrawableUsdt"], 0)
        self.assertGreater(manual.get_json()["balances"]["purchaseOnlyUsdt"], 0)

        self.client.post("/api/auth/logout", json={})
        self.login_user("manual@test.com")
        buy = self.client.post("/api/user/mining/contracts", json={"planId": plan_id})
        self.assertEqual(buy.status_code, 201)
        withdrawal = self.client.post(
            "/api/user/withdrawals",
            json={
                "asset": "USDT",
                "network": "USDT",
                "address": "TNO_WITHDRAW",
                "amount": 1,
            },
        )
        self.assertEqual(withdrawal.status_code, 400)

    def test_manual_credit_requires_positive_amount(self):
        self.register_user("manual2@test.com")
        with app.app_context():
            admin_id = User.query.filter_by(is_admin=True).first().id
            user_id = User.query.filter_by(email="manual2@test.com").first().id
        with self.client.session_transaction() as sess:
            sess["admin_user_id"] = admin_id

        bad = self.client.post(
            f"/admin/api/users/{user_id}/manual-credit",
            json={"amount": -5, "reason": "invalid"},
        )
        self.assertEqual(bad.status_code, 400)

    def test_negative_invalid_reset_token(self):
        register = self.register_user("u2@test.com")
        self.assertEqual(register.status_code, 201)
        reset = self.client.post(
            "/api/auth/reset-password",
            json={"token": "invalid-token", "password": "newpassword123"},
        )
        self.assertEqual(reset.status_code, 400)

    def test_negative_replay_tx_hash(self):
        self.register_user("u3@test.com")
        self.login_user("u3@test.com")
        wallets = self.client.get("/api/wallet/addresses")
        wallet_id = wallets.get_json()[0]["id"]

        first = self.client.post(
            "/api/wallet/topup",
            json={"walletId": wallet_id, "txHash": self._tx(2), "amount": 5},
        )
        self.assertEqual(first.status_code, 201)
        replay = self.client.post(
            "/api/wallet/topup",
            json={"walletId": wallet_id, "txHash": self._tx(2), "amount": 5},
        )
        self.assertEqual(replay.status_code, 409)

    def test_negative_double_credit_guard(self):
        self.register_user("u4@test.com")
        self.login_user("u4@test.com")
        wallets = self.client.get("/api/wallet/addresses")
        wallet_id = wallets.get_json()[0]["id"]

        create = self.client.post(
            "/api/wallet/topup",
            json={"walletId": wallet_id, "txHash": self._tx(3), "amount": 7},
        )
        topup_id = create.get_json()["topup"]["id"]
        with app.app_context():
            topup = TopUpTransaction.query.get(topup_id)
            settle_topup(topup)
            settle_topup(topup)
            credits = UserBalanceLedger.query.filter_by(
                topup_id=topup_id, entry_type="credit"
            ).count()
            self.assertEqual(credits, 1)

    def test_negative_amount_mismatch(self):
        self.register_user("u5@test.com")
        self.login_user("u5@test.com")
        wallet_id = self.client.get("/api/wallet/addresses").get_json()[0]["id"]
        create = self.client.post(
            "/api/wallet/topup",
            json={"walletId": wallet_id, "txHash": self._tx(4), "amount": 100},
        )
        topup_id = create.get_json()["topup"]["id"]

        original = wallet_verifier_module.verify_with_provider
        wallet_verifier_module.verify_with_provider = lambda *_args, **_kwargs: {
            "confirmed": True,
            "toAddress": "TTEST123",
            "amount": "50",
            "confirmations": 2,
            "message": "confirmed",
            "errorCode": None,
        }
        try:
            result = self.client.post(f"/api/wallet/topup/{topup_id}/process-now")
            self.assertEqual(result.status_code, 200)
            payload = self.client.get("/api/wallet/topups").get_json()[0]
            self.assertEqual(payload["status"], "pending")
            self.assertEqual(payload["lastErrorCode"], "AMOUNT_MISMATCH")
        finally:
            wallet_verifier_module.verify_with_provider = original

    def test_referral_code_and_stats(self):
        self.register_user("ref1@test.com")
        self.login_user("ref1@test.com")
        referral = self.client.get("/api/user/referral")
        self.assertEqual(referral.status_code, 200)
        code = referral.get_json()["code"]
        self.client.post("/api/auth/logout", json={})
        self.register_user("ref2@test.com", referral_code=code)
        self.login_user("ref1@test.com")
        referral_after = self.client.get("/api/user/referral").get_json()
        self.assertGreaterEqual(referral_after["invitesByLevel"]["1"], 1)

    def test_kyc_submit_and_admin_review(self):
        self.register_user("kyc@test.com")
        self.login_user("kyc@test.com")
        submit = self.client.post(
            "/api/user/kyc/submit",
            data={
                "country": "RU",
                "docType": "passport",
                "document": (BytesIO(b"fake-pdf"), "doc.pdf", "application/pdf"),
            },
            content_type="multipart/form-data",
        )
        self.assertEqual(submit.status_code, 200)
        with app.app_context():
            profile = KycProfile.query.filter_by(
                user_id=User.query.filter_by(email="kyc@test.com").first().id
            ).first()
            self.assertIsNotNone(profile)
            admin = User.query.filter_by(is_admin=True).first()
            admin_id = admin.id
            profile_id = profile.id
        with self.client.session_transaction() as sess:
            sess["admin_user_id"] = admin_id
        review = self.client.post(
            f"/admin/api/kyc/{profile_id}/review", json={"decision": "approved"}
        )
        self.assertEqual(review.status_code, 200)

    def test_admin_request_verification_blocks_withdraw_until_approved(self):
        self.register_user("kycfreeze@test.com")
        self.login_user("kycfreeze@test.com")
        with app.app_context():
            user = User.query.filter_by(email="kycfreeze@test.com").first()
            db.session.add(
                UserBalanceLedger(
                    user_id=user.id,
                    amount=100,
                    entry_type="credit",
                    reason="Seed balance",
                    asset="USDT",
                    network="TRX",
                )
            )
            db.session.commit()
            user_id = user.id
            admin_id = User.query.filter_by(is_admin=True).first().id

        with self.client.session_transaction() as sess:
            sess["admin_user_id"] = admin_id
        request_verification = self.client.post(
            "/admin/api/kyc/request-verification",
            json={"userId": user_id, "reason": "manual check"},
        )
        self.assertEqual(request_verification.status_code, 200)

        profiles = self.client.get("/admin/api/kyc/profiles?status=not_started")
        self.assertEqual(profiles.status_code, 200)
        self.assertTrue(
            any(
                int(item["userId"]) == int(user_id) and item["verificationRequested"]
                for item in profiles.get_json()["items"]
            )
        )

        self.client.post("/api/auth/logout", json={})
        self.login_user("kycfreeze@test.com")
        blocked = self.client.post(
            "/api/user/withdrawals",
            json={
                "asset": "USDT",
                "network": "TRX",
                "address": "TFREEZE",
                "amount": 10,
            },
        )
        self.assertEqual(blocked.status_code, 403)
        self.assertEqual(blocked.get_json().get("code"), "KYC_VERIFICATION_REQUIRED")

        self.client.post(
            "/api/user/kyc/submit",
            data={
                "country": "US",
                "docType": "passport",
                "document": (BytesIO(b"freeze-doc"), "doc.pdf", "application/pdf"),
            },
            content_type="multipart/form-data",
        )
        with app.app_context():
            profile = KycProfile.query.filter_by(user_id=user_id).first()
            profile_id = profile.id
            first_doc = KycDocument.query.filter_by(profile_id=profile_id).first()
            self.assertIsNotNone(first_doc)
            doc_id = first_doc.id

        with self.client.session_transaction() as sess:
            sess["admin_user_id"] = admin_id
        doc_open = self.client.get(f"/admin/api/kyc/document/{doc_id}")
        self.assertEqual(doc_open.status_code, 200)
        approve = self.client.post(
            f"/admin/api/kyc/{profile_id}/review", json={"decision": "approved"}
        )
        self.assertEqual(approve.status_code, 200)

        self.client.post("/api/auth/logout", json={})
        self.login_user("kycfreeze@test.com")
        allowed = self.client.post(
            "/api/user/withdrawals",
            json={
                "asset": "USDT",
                "network": "TRX",
                "address": "TFREEZE2",
                "amount": 10,
            },
        )
        self.assertEqual(allowed.status_code, 201)

    def test_support_ticket_flow(self):
        self.register_user("support@test.com")
        self.login_user("support@test.com")
        create = self.client.post(
            "/api/user/support/tickets",
            json={
                "subject": "Need help",
                "priority": "high",
                "category": "technical",
                "message": "Issue details",
            },
        )
        self.assertEqual(create.status_code, 201)
        ticket_id = create.get_json()["ticketId"]
        self.assertIsNotNone(ticket_id)
        user_msg = self.client.post(
            f"/api/user/support/tickets/{ticket_id}/messages", json={"message": "Ping"}
        )
        self.assertEqual(user_msg.status_code, 200)
        user_messages = self.client.get(
            f"/api/user/support/tickets/{ticket_id}/messages"
        )
        self.assertEqual(user_messages.status_code, 200)
        self.assertTrue(
            all("eventType" in item for item in user_messages.get_json()["messages"])
        )

        close = self.client.post(
            f"/api/user/support/tickets/{ticket_id}/close", json={}
        )
        self.assertEqual(close.status_code, 200)
        self.assertEqual(close.get_json()["status"], "closed")
        closed_send = self.client.post(
            f"/api/user/support/tickets/{ticket_id}/messages",
            json={"message": "after close"},
        )
        self.assertEqual(closed_send.status_code, 400)

        with app.app_context():
            admin = User.query.filter_by(is_admin=True).first()
            admin_id = admin.id
        with self.client.session_transaction() as sess:
            sess["admin_user_id"] = admin_id
        action = self.client.post(
            f"/admin/api/support/tickets/{ticket_id}/action", json={"action": "assign"}
        )
        self.assertEqual(action.status_code, 200)

    def test_team_application_submit_and_admin_panel(self):
        original_send = user_routes_module.send_team_application_email
        user_routes_module.send_team_application_email = lambda *_args, **_kwargs: None
        try:
            response = self.client.post(
                "/api/user/team-applications",
                json={
                    "fullName": "Ivan Petrov",
                    "email": "ivan.petrov@test.com",
                    "role": "Support Operator",
                    "experience": "3",
                    "message": "I have relevant support experience.",
                },
            )
            self.assertEqual(response.status_code, 201)
            with app.app_context():
                self.assertEqual(TeamApplication.query.count(), 1)
                admin_id = User.query.filter_by(is_admin=True).first().id
            with self.client.session_transaction() as sess:
                sess["admin_user_id"] = admin_id
            panel = self.client.get("/admin/panel")
            self.assertEqual(panel.status_code, 200)
            self.assertIn(b"ivan.petrov@test.com", panel.data)
        finally:
            user_routes_module.send_team_application_email = original_send

    def test_withdrawal_manual_flow(self):
        self.register_user("wd@test.com")
        self.login_user("wd@test.com")
        with app.app_context():
            user = User.query.filter_by(email="wd@test.com").first()
            db.session.add(
                UserBalanceLedger(
                    user_id=user.id,
                    amount=100,
                    entry_type="credit",
                    reason="Seed balance",
                    asset="USDT",
                    network="TRX",
                )
            )
            db.session.commit()

        create = self.client.post(
            "/api/user/withdrawals",
            json={
                "asset": "USDT",
                "network": "TRX",
                "address": "TWD123",
                "memo": "",
                "amount": 25,
            },
        )
        self.assertEqual(create.status_code, 201)
        withdrawal_id = create.get_json()["withdrawal"]["id"]

        with app.app_context():
            hold_entries = UserBalanceLedger.query.filter_by(
                withdrawal_id=withdrawal_id, entry_type="withdrawal_hold"
            ).count()
            self.assertEqual(hold_entries, 1)
            admin = User.query.filter_by(is_admin=True).first()
            admin_id = admin.id

        with self.client.session_transaction() as sess:
            sess["admin_user_id"] = admin_id
        admin_list = self.client.get("/admin/api/withdrawals")
        self.assertEqual(admin_list.status_code, 200)
        self.assertTrue(any(int(item["id"]) == int(withdrawal_id) for item in (admin_list.get_json() or [])))
        approve = self.client.post(
            f"/admin/api/withdrawals/{withdrawal_id}/action", json={"action": "approve"}
        )
        self.assertEqual(approve.status_code, 200)
        processing = self.client.post(
            f"/admin/api/withdrawals/{withdrawal_id}/action",
            json={"action": "start_processing"},
        )
        self.assertEqual(processing.status_code, 200)
        complete = self.client.post(
            f"/admin/api/withdrawals/{withdrawal_id}/action",
            json={
                "action": "complete",
                "externalTxHash": "0xwdone",
                "adminNote": "sent",
            },
        )
        self.assertEqual(complete.status_code, 200)
        with app.app_context():
            finalize_entries = UserBalanceLedger.query.filter_by(
                withdrawal_id=withdrawal_id, entry_type="withdrawal_finalize"
            ).count()
            self.assertEqual(finalize_entries, 1)
            row = WithdrawalRequest.query.get(withdrawal_id)
            self.assertEqual(row.status, "completed")
        self.client.post("/api/auth/logout", json={})
        self.login_user("wd@test.com")
        user_withdrawals = self.client.get("/api/user/withdrawals")
        self.assertEqual(user_withdrawals.status_code, 200)
        mapped = next((item for item in (user_withdrawals.get_json() or []) if int(item["id"]) == int(withdrawal_id)), None)
        self.assertIsNotNone(mapped)
        self.assertEqual(mapped.get("status"), "completed")
        self.assertEqual(mapped.get("rawStatus"), "completed")

    def test_withdrawal_legacy_usdt_network_bucket_supported(self):
        self.register_user("wdlegacy@test.com")
        self.login_user("wdlegacy@test.com")
        with app.app_context():
            user = User.query.filter_by(email="wdlegacy@test.com").first()
            db.session.add(
                UserBalanceLedger(
                    user_id=user.id,
                    amount=80,
                    entry_type="credit",
                    reason="Legacy seed balance",
                    asset="USDT",
                    network="USDT",
                )
            )
            db.session.commit()
        create = self.client.post(
            "/api/user/withdrawals",
            json={"asset": "USDT", "network": "TRX", "address": "TLEGACY", "amount": 25},
        )
        self.assertEqual(create.status_code, 201)

    def test_withdrawal_reject_releases_funds(self):
        self.register_user("wd2@test.com")
        self.login_user("wd2@test.com")
        with app.app_context():
            user = User.query.filter_by(email="wd2@test.com").first()
            db.session.add(
                UserBalanceLedger(
                    user_id=user.id,
                    amount=50,
                    entry_type="credit",
                    reason="Seed balance",
                    asset="USDT",
                    network="TRX",
                )
            )
            db.session.commit()
            admin = User.query.filter_by(is_admin=True).first()
            admin_id = admin.id

        create = self.client.post(
            "/api/user/withdrawals",
            json={"asset": "USDT", "network": "TRX", "address": "TWDREJ", "amount": 20},
        )
        self.assertEqual(create.status_code, 201)
        withdrawal_id = create.get_json()["withdrawal"]["id"]
        with self.client.session_transaction() as sess:
            sess["admin_user_id"] = admin_id
        reject = self.client.post(
            f"/admin/api/withdrawals/{withdrawal_id}/action",
            json={"action": "reject", "adminNote": "bad destination"},
        )
        self.assertEqual(reject.status_code, 200)
        with app.app_context():
            release_entries = UserBalanceLedger.query.filter_by(
                withdrawal_id=withdrawal_id, entry_type="withdrawal_release"
            ).count()
            self.assertEqual(release_entries, 1)

    def test_withdrawal_insufficient_balance(self):
        self.register_user("wd3@test.com")
        self.login_user("wd3@test.com")
        create = self.client.post(
            "/api/user/withdrawals",
            json={"asset": "USDT", "network": "TRX", "address": "TNOBAL", "amount": 1},
        )
        self.assertEqual(create.status_code, 400)

    def test_withdrawal_authz_boundaries(self):
        self.register_user("wda@test.com")
        self.login_user("wda@test.com")
        with app.app_context():
            user = User.query.filter_by(email="wda@test.com").first()
            db.session.add(
                UserBalanceLedger(
                    user_id=user.id,
                    amount=30,
                    entry_type="credit",
                    reason="Seed balance",
                    asset="USDT",
                    network="TRX",
                )
            )
            db.session.commit()
        create = self.client.post(
            "/api/user/withdrawals",
            json={"asset": "USDT", "network": "TRX", "address": "TAUTH", "amount": 10},
        )
        withdrawal_id = create.get_json()["withdrawal"]["id"]
        self.client.post("/api/auth/logout", json={})
        self.register_user("wdb@test.com")
        self.login_user("wdb@test.com")
        cancel_other = self.client.post(
            f"/api/user/withdrawals/{withdrawal_id}/cancel", json={}
        )
        self.assertEqual(cancel_other.status_code, 404)
        admin_action_without_admin = self.client.post(
            f"/admin/api/withdrawals/{withdrawal_id}/action",
            json={"action": "approve"},
        )
        self.assertEqual(admin_action_without_admin.status_code, 403)

    def test_mining_purchase_and_accrual_idempotent(self):
        self.register_user("miner@test.com")
        self.login_user("miner@test.com")
        with app.app_context():
            user = User.query.filter_by(email="miner@test.com").first()
            db.session.add(
                UserBalanceLedger(
                    user_id=user.id,
                    amount=2000,
                    entry_type="credit",
                    reason="Seed USDT",
                    asset="USDT",
                    network="USDT",
                )
            )
            db.session.commit()

        plans = self.client.get("/api/user/mining/plans")
        self.assertEqual(plans.status_code, 200)
        plan_id = plans.get_json()[0]["id"]
        buy = self.client.post("/api/user/mining/contracts", json={"planId": plan_id})
        self.assertEqual(buy.status_code, 201)
        contract_id = buy.get_json()["contract"]["id"]

        with app.app_context():
            run_daily_mining_accruals()
            run_daily_mining_accruals()
            accrual_count = MiningAccrual.query.filter_by(
                contract_id=contract_id
            ).count()
            self.assertEqual(accrual_count, 1)

    def test_mining_hourly_accrual_and_withdrawable_profit(self):
        self.register_user("minerhour@test.com")
        self.login_user("minerhour@test.com")
        with app.app_context():
            user = User.query.filter_by(email="minerhour@test.com").first()
            db.session.add(
                UserBalanceLedger(
                    user_id=user.id,
                    amount=2000,
                    entry_type="credit",
                    reason="Seed USDT",
                    asset="USDT",
                    network="USDT",
                )
            )
            db.session.commit()
        plan_id = self.client.get("/api/user/mining/plans").get_json()[0]["id"]
        buy = self.client.post("/api/user/mining/contracts", json={"planId": plan_id})
        self.assertEqual(buy.status_code, 201)
        contract_id = buy.get_json()["contract"]["id"]

        with app.app_context():
            now = datetime.utcnow().replace(minute=0, second=0, microsecond=0)
            run_daily_mining_accruals(now)
            run_daily_mining_accruals(now)
            run_daily_mining_accruals(now + timedelta(hours=1))
            accrual_count = MiningAccrual.query.filter_by(
                contract_id=contract_id
            ).count()
            self.assertEqual(accrual_count, 2)

        accruals = self.client.get("/api/user/mining/accruals")
        self.assertEqual(accruals.status_code, 200)
        first = accruals.get_json()[0]
        self.assertIn("accrualAt", first)

        balance = self.client.get("/api/user/balance").get_json()
        self.assertGreater(float(balance.get("withdrawableBalance") or 0), 0)

    def test_mining_purchase_insufficient_balance(self):
        self.register_user("miner2@test.com")
        self.login_user("miner2@test.com")
        plan_id = self.client.get("/api/user/mining/plans").get_json()[0]["id"]
        buy = self.client.post("/api/user/mining/contracts", json={"planId": plan_id})
        self.assertEqual(buy.status_code, 400)

    def test_admin_mining_plan_crud(self):
        with app.app_context():
            admin_id = User.query.filter_by(is_admin=True).first().id
        with self.client.session_transaction() as sess:
            sess["admin_user_id"] = admin_id
        create = self.client.post(
            "/admin/api/mining/plans",
            json={
                "name": "Test plan",
                "strategy": "btc_sha256",
                "hashrateValue": 10,
                "hashrateUnit": "TH/s",
                "durationDays": 30,
                "priceUsdt": 99,
                "isActive": True,
            },
        )
        self.assertEqual(create.status_code, 200)
        plan_id = create.get_json()["id"]
        toggle = self.client.post(f"/admin/api/mining/plans/{plan_id}/toggle", json={})
        self.assertEqual(toggle.status_code, 200)

    def test_topup_conversion_to_usdt(self):
        self.register_user("conv@test.com")
        self.login_user("conv@test.com")
        wallet_id = self.client.get("/api/wallet/addresses").get_json()[0]["id"]
        create = self.client.post(
            "/api/wallet/topup",
            json={"walletId": wallet_id, "txHash": self._tx(5), "amount": 10},
        )
        topup_id = create.get_json()["topup"]["id"]

        original_convert = wallet_verifier_module.convert_to_usdt
        wallet_verifier_module.convert_to_usdt = lambda _asset, _amount: {
            "source": "coingecko",
            "baseAsset": "USDT",
            "quoteAsset": "USDT",
            "rate": 1,
            "originalAmount": 10,
            "convertedAmount": 10,
            "timestamp": 0,
        }
        try:
            with app.app_context():
                topup = TopUpTransaction.query.get(topup_id)
                settle_topup(topup)
                credit = UserBalanceLedger.query.filter_by(
                    topup_id=topup_id, entry_type="credit"
                ).first()
                self.assertIsNotNone(credit)
                self.assertEqual(credit.asset, "USDT")
                self.assertEqual(credit.network, "TRX")
        finally:
            wallet_verifier_module.convert_to_usdt = original_convert

    def test_topup_requires_valid_tron_hash(self):
        self.register_user("hash@test.com")
        self.login_user("hash@test.com")
        wallet_id = self.client.get("/api/wallet/addresses").get_json()[0]["id"]
        bad = self.client.post(
            "/api/wallet/topup",
            json={"walletId": wallet_id, "txHash": "invalid-hash", "amount": 10},
        )
        self.assertEqual(bad.status_code, 400)
        self.assertEqual(bad.get_json().get("code"), "INVALID_TX_HASH")

    def test_topup_rejects_non_usdt_wallet(self):
        self.register_user("asset@test.com")
        self.login_user("asset@test.com")
        with app.app_context():
            db.session.add(
                WalletAddress(
                    asset="BTC", network="BTC", address="btc-wallet", is_active=True
                )
            )
            db.session.commit()
            wallet_id = (
                WalletAddress.query.filter_by(asset="BTC", network="BTC").first().id
            )
        response = self.client.post(
            "/api/wallet/topup",
            json={"walletId": wallet_id, "txHash": self._tx(6), "amount": 5},
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json().get("code"), "UNSUPPORTED_ASSET")

    def test_topup_fails_when_provider_amount_or_address_missing(self):
        self.register_user("prov@test.com")
        self.login_user("prov@test.com")
        wallet_id = self.client.get("/api/wallet/addresses").get_json()[0]["id"]
        create = self.client.post(
            "/api/wallet/topup",
            json={"walletId": wallet_id, "txHash": self._tx(7), "amount": 10},
        )
        topup_id = create.get_json()["topup"]["id"]

        original = wallet_verifier_module.verify_with_provider
        wallet_verifier_module.verify_with_provider = lambda *_args, **_kwargs: {
            "confirmed": True,
            "toAddress": None,
            "amount": None,
            "confirmations": 5,
            "message": "confirmed",
            "errorCode": None,
        }
        try:
            self.client.post(f"/api/wallet/topup/{topup_id}/process-now")
            payload = self.client.get("/api/wallet/topups").get_json()[0]
            self.assertEqual(payload["status"], "pending")
            self.assertEqual(payload["lastErrorCode"], "ADDRESS_UNAVAILABLE")
        finally:
            wallet_verifier_module.verify_with_provider = original

    def test_dashboard_notifications_presets_and_checklist(self):
        self.register_user("notify@test.com")
        self.login_user("notify@test.com")
        with app.app_context():
            user = User.query.filter_by(email="notify@test.com").first()
            db.session.add(
                DashboardNotification(
                    user_id=user.id,
                    event_type="manual_test",
                    category="system",
                    priority="low",
                    title="Test notification",
                    message="hello",
                    deep_link="/dashboard/overview",
                    external_ref="manual:1",
                    is_read=False,
                )
            )
            db.session.commit()

        listed = self.client.get("/api/user/dashboard/notifications")
        self.assertEqual(listed.status_code, 200)
        items = listed.get_json()["items"]
        self.assertGreaterEqual(len(items), 1)
        notif_id = items[0]["id"]
        mark = self.client.post(
            f"/api/user/dashboard/notifications/{notif_id}/read", json={"isRead": True}
        )
        self.assertEqual(mark.status_code, 200)

        preset_save = self.client.post(
            "/api/user/dashboard/filter-presets",
            json={
                "scope": "withdrawals",
                "name": "quick",
                "payload": {"status": "pending"},
            },
        )
        self.assertEqual(preset_save.status_code, 200)
        preset_list = self.client.get(
            "/api/user/dashboard/filter-presets?scope=withdrawals"
        )
        self.assertEqual(preset_list.status_code, 200)
        self.assertGreaterEqual(len(preset_list.get_json()), 1)
        preset_id = preset_list.get_json()[0]["id"]
        preset_delete = self.client.delete(
            f"/api/user/dashboard/filter-presets/{preset_id}"
        )
        self.assertEqual(preset_delete.status_code, 200)

        checklist = self.client.get("/api/user/dashboard/onboarding-checklist")
        self.assertEqual(checklist.status_code, 200)
        self.assertEqual(checklist.get_json()["total"], 4)


if __name__ == "__main__":
    unittest.main()
