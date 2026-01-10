from aws_cdk import (
    Stack,
    RemovalPolicy,
    CfnOutput,
    Duration,
    aws_cognito as cognito,
    aws_lambda as _lambda,
    aws_apigateway as apigw,
    aws_dynamodb as dynamodb,
    aws_iam as iam,
)
from constructs import Construct


class MyCdkAppStack(Stack):

    def __init__(self, scope: Construct, construct_id: str, **kwargs):
        super().__init__(scope, construct_id, env={
                "account": "896823725438",
                "region": "ap-south-1",
            }, **kwargs)

        # ⚡ Post Confirmation Lambda (for auto-adding users to groups)
        post_confirmation_lambda = _lambda.Function(
            self,
            "PostConfirmationLambda",
            runtime=_lambda.Runtime.PYTHON_3_12,
            handler="post_confirmation_handler.handler",
            code=_lambda.Code.from_asset("lambda"),
            timeout=Duration.seconds(10),
        )

        # 🔐 Custom Auth Lambdas for Passwordless OTP Login
        define_auth_lambda = _lambda.Function(
            self,
            "DefineAuthChallengeLambda",
            runtime=_lambda.Runtime.PYTHON_3_12,
            handler="define_auth_challenge.handler",
            code=_lambda.Code.from_asset("lambda"),
            timeout=Duration.seconds(10),
        )

        create_auth_lambda = _lambda.Function(
            self,
            "CreateAuthChallengeLambda",
            runtime=_lambda.Runtime.PYTHON_3_12,
            handler="create_auth_challenge.handler",
            code=_lambda.Code.from_asset("lambda"),
            timeout=Duration.seconds(30),
        )

        verify_auth_lambda = _lambda.Function(
            self,
            "VerifyAuthChallengeLambda",
            runtime=_lambda.Runtime.PYTHON_3_12,
            handler="verify_auth_challenge.handler",
            code=_lambda.Code.from_asset("lambda"),
            timeout=Duration.seconds(10),
        )

        # Grant SNS permissions to CreateAuthChallenge Lambda (for sending SMS)
        create_auth_lambda.add_to_role_policy(
            iam.PolicyStatement(
                actions=["sns:Publish"],
                resources=["*"]
            )
        )

        # 🔐 Cognito User Pool with MFA, Phone/Email Login and Custom Auth
        user_pool = cognito.UserPool(
            self,
            "UserPool",
            self_sign_up_enabled=True,
            sign_in_aliases=cognito.SignInAliases(
                username=True, 
                email=True,
                phone=True
            ),
            # Make email and phone optional for flexibility
            standard_attributes=cognito.StandardAttributes(
                email=cognito.StandardAttribute(required=False, mutable=True),
                phone_number=cognito.StandardAttribute(required=False, mutable=True),
            ),
            custom_attributes={
                "role": cognito.StringAttribute(mutable=True)
            },
            password_policy=cognito.PasswordPolicy(
                min_length=8,
                require_digits=True,
                require_lowercase=True,
                require_uppercase=True,
                require_symbols=True,
            ),
            mfa=cognito.Mfa.OPTIONAL,
            mfa_second_factor=cognito.MfaSecondFactor(
                sms=True,
                otp=True
            ),
            account_recovery=cognito.AccountRecovery.EMAIL_AND_PHONE_WITHOUT_MFA,
            removal_policy=RemovalPolicy.DESTROY,
            # 🎯 Lambda Triggers for Auth
            lambda_triggers=cognito.UserPoolTriggers(
                post_confirmation=post_confirmation_lambda,
                define_auth_challenge=define_auth_lambda,
                create_auth_challenge=create_auth_lambda,
                verify_auth_challenge_response=verify_auth_lambda
            )
        )

        # Grant Lambda permission to add users to groups (Fixed Circular Dependency)
        post_confirmation_lambda.add_to_role_policy(
            iam.PolicyStatement(
                actions=["cognito-idp:AdminAddUserToGroup"],
                resources=[f"arn:aws:cognito-idp:{self.region}:{self.account}:userpool/*"]
            )
        )

        # 👥 Create Cognito Groups
        dm_role_group = cognito.CfnUserPoolGroup(
            self,
            "DMRoleGroup",
            user_pool_id=user_pool.user_pool_id,
            group_name="DMrole",
            description="Users who can perform Divide and Multiply operations",
            precedence=1
        )

        as_role_group = cognito.CfnUserPoolGroup(
            self,
            "ASRoleGroup",
            user_pool_id=user_pool.user_pool_id,
            group_name="ASrole",
            description="Users who can perform Add and Subtract operations",
            precedence=2
        )

        # 👑 Admin Role Group (highest precedence)
        admin_role_group = cognito.CfnUserPoolGroup(
            self,
            "AdminRoleGroup",
            user_pool_id=user_pool.user_pool_id,
            group_name="AdminRole",
            description="Administrators with full access",
            precedence=0  # Highest precedence
        )

        # 📱 User Pool Client (App client) with Custom Auth Flow
        user_pool_client = cognito.UserPoolClient(
            self,
            "UserPoolClient",
            user_pool=user_pool,
            auth_flows=cognito.AuthFlow(
                user_password=True,
                user_srp=True,
                custom=True  # Enable CUSTOM_AUTH for passwordless OTP
            ),
            generate_secret=False,
            read_attributes=cognito.ClientAttributes()
                .with_standard_attributes(email=True, phone_number=True)
                .with_custom_attributes("role"),
            write_attributes=cognito.ClientAttributes()
                .with_standard_attributes(email=True, phone_number=True)
                .with_custom_attributes("role"),
        )
        
        # 📊 DynamoDB Tables
        history_table = dynamodb.Table(
            self,
            "CalculatorHistory",
            partition_key=dynamodb.Attribute(
                name="userId",
                type=dynamodb.AttributeType.STRING
            ),
            sort_key=dynamodb.Attribute(
                name="timestamp",
                type=dynamodb.AttributeType.STRING
            ),
            billing_mode=dynamodb.BillingMode.PAY_PER_REQUEST,
            removal_policy=RemovalPolicy.DESTROY,
        )

        # 🎭 Roles Table for custom roles
        roles_table = dynamodb.Table(
            self,
            "RolesTable",
            partition_key=dynamodb.Attribute(
                name="roleName",
                type=dynamodb.AttributeType.STRING
            ),
            billing_mode=dynamodb.BillingMode.PAY_PER_REQUEST,
            removal_policy=RemovalPolicy.DESTROY,
        )

        # ⚡ Lambda Function for Calculations
        calculate_lambda = _lambda.Function(
            self,
            "CalculateLambda",
            runtime=_lambda.Runtime.PYTHON_3_12,
            handler="calculate_handler.handler",
            code=_lambda.Code.from_asset("lambda"),
            timeout=Duration.seconds(30),
            environment={
                "HISTORY_TABLE": history_table.table_name,
                "ROLES_TABLE": roles_table.table_name
            }
        )

        # Grant Lambda permissions to DynamoDB
        history_table.grant_read_write_data(calculate_lambda)
        roles_table.grant_read_data(calculate_lambda)

        # 👑 Admin Lambda Function
        admin_lambda = _lambda.Function(
            self,
            "AdminLambda",
            runtime=_lambda.Runtime.PYTHON_3_12,
            handler="admin_handler.handler",
            code=_lambda.Code.from_asset("lambda"),
            timeout=Duration.seconds(30),
            environment={
                "USER_POOL_ID": user_pool.user_pool_id,
                "HISTORY_TABLE": history_table.table_name,
                "ROLES_TABLE": roles_table.table_name
            }
        )

        # Grant Admin Lambda permissions
        history_table.grant_read_write_data(admin_lambda)
        roles_table.grant_read_write_data(admin_lambda)
        
        # Grant Cognito admin permissions to Admin Lambda
        admin_lambda.add_to_role_policy(
            iam.PolicyStatement(
                actions=[
                    "cognito-idp:ListUsers",
                    "cognito-idp:AdminListGroupsForUser",
                    "cognito-idp:AdminAddUserToGroup",
                    "cognito-idp:AdminRemoveUserFromGroup",
                    "cognito-idp:AdminUpdateUserAttributes",
                    "cognito-idp:AdminDisableUser",
                    "cognito-idp:AdminEnableUser",
                    "cognito-idp:AdminDeleteUser",
                    "cognito-idp:CreateGroup",
                    "cognito-idp:DeleteGroup"
                ],
                resources=[f"arn:aws:cognito-idp:{self.region}:{self.account}:userpool/*"]
            )
        )

        # 🌐 API Gateway
        api = apigw.RestApi(
            self,
            "CalculatorApi",
            rest_api_name="Calculator API",
            description="API for calculator with Cognito authentication and RBAC",
            default_cors_preflight_options=apigw.CorsOptions(
                allow_origins=apigw.Cors.ALL_ORIGINS,
                allow_methods=apigw.Cors.ALL_METHODS,
                allow_headers=["Content-Type", "Authorization"],
            )
        )

        # Cognito Authorizer
        authorizer = apigw.CognitoUserPoolsAuthorizer(
            self,
            "CognitoAuthorizer",
            cognito_user_pools=[user_pool]
        )

        # /calculate endpoint
        calculate_resource = api.root.add_resource("calculate")
        calculate_resource.add_method(
            "POST",
            apigw.LambdaIntegration(calculate_lambda),
            authorizer=authorizer,
            authorization_type=apigw.AuthorizationType.COGNITO,
        )

        # /roles endpoint (public for registration dropdown)
        roles_resource = api.root.add_resource("roles")
        roles_resource.add_method(
            "GET",
            apigw.LambdaIntegration(admin_lambda),
            authorizer=authorizer,
            authorization_type=apigw.AuthorizationType.COGNITO,
        )

        # 👑 Admin endpoints
        admin_resource = api.root.add_resource("admin")
        
        # /admin/users
        users_resource = admin_resource.add_resource("users")
        users_resource.add_method("GET", apigw.LambdaIntegration(admin_lambda), authorizer=authorizer, authorization_type=apigw.AuthorizationType.COGNITO)
        users_resource.add_method("DELETE", apigw.LambdaIntegration(admin_lambda), authorizer=authorizer, authorization_type=apigw.AuthorizationType.COGNITO)
        
        # /admin/users/role
        user_role_resource = users_resource.add_resource("role")
        user_role_resource.add_method("POST", apigw.LambdaIntegration(admin_lambda), authorizer=authorizer, authorization_type=apigw.AuthorizationType.COGNITO)
        
        # /admin/users/block
        user_block_resource = users_resource.add_resource("block")
        user_block_resource.add_method("POST", apigw.LambdaIntegration(admin_lambda), authorizer=authorizer, authorization_type=apigw.AuthorizationType.COGNITO)
        
        # /admin/roles
        admin_roles_resource = admin_resource.add_resource("roles")
        admin_roles_resource.add_method("GET", apigw.LambdaIntegration(admin_lambda), authorizer=authorizer, authorization_type=apigw.AuthorizationType.COGNITO)
        admin_roles_resource.add_method("POST", apigw.LambdaIntegration(admin_lambda), authorizer=authorizer, authorization_type=apigw.AuthorizationType.COGNITO)
        admin_roles_resource.add_method("DELETE", apigw.LambdaIntegration(admin_lambda), authorizer=authorizer, authorization_type=apigw.AuthorizationType.COGNITO)
        
        # /admin/history
        admin_history_resource = admin_resource.add_resource("history")
        admin_history_resource.add_method("GET", apigw.LambdaIntegration(admin_lambda), authorizer=authorizer, authorization_type=apigw.AuthorizationType.COGNITO)
        admin_history_resource.add_method("DELETE", apigw.LambdaIntegration(admin_lambda), authorizer=authorizer, authorization_type=apigw.AuthorizationType.COGNITO)

        # 📤 Outputs
        CfnOutput(self, "UserPoolId", value=user_pool.user_pool_id)
        CfnOutput(self, "UserPoolClientId", value=user_pool_client.user_pool_client_id)
        CfnOutput(self, "ApiEndpoint", value=api.url)
        CfnOutput(self, "Region", value=self.region)

