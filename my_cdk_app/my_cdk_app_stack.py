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

        # 🔐 Cognito User Pool with MFA and Phone Login
        user_pool = cognito.UserPool(
            self,
            "UserPool",
            self_sign_up_enabled=True,
            sign_in_aliases=cognito.SignInAliases(
                username=True, 
                email=True,
                phone=True  # Enable phone login
            ),
            standard_attributes=cognito.StandardAttributes(
                email=cognito.StandardAttribute(required=True, mutable=True),
                phone_number=cognito.StandardAttribute(required=False, mutable=True),
            ),
            password_policy=cognito.PasswordPolicy(
                min_length=8,
                require_digits=True,
                require_lowercase=True,
                require_uppercase=True,
                require_symbols=True,
            ),
            # 🔒 MFA Configuration
            mfa=cognito.Mfa.OPTIONAL,  # Users can enable MFA
            mfa_second_factor=cognito.MfaSecondFactor(
                sms=True,   # SMS-based MFA
                otp=True    # TOTP (Authenticator app)
            ),
            account_recovery=cognito.AccountRecovery.EMAIL_AND_PHONE_WITHOUT_MFA,
            removal_policy=RemovalPolicy.DESTROY,
        )

        # 👥 Create Cognito Groups for Role-Based Access
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

        # 📱 User Pool Client (App client)
        user_pool_client = cognito.UserPoolClient(
            self,
            "UserPoolClient",
            user_pool=user_pool,
            auth_flows=cognito.AuthFlow(
                user_password=True,
                user_srp=True
            ),
            generate_secret=False,
            # Include groups in the ID token
            read_attributes=cognito.ClientAttributes().with_standard_attributes(
                email=True,
                phone_number=True,
            ),
            write_attributes=cognito.ClientAttributes().with_standard_attributes(
                email=True,
                phone_number=True,
            ),
        )

        # 📊 DynamoDB Table for Calculator History
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

        # ⚡ Lambda Function for Calculations
        calculate_lambda = _lambda.Function(
            self,
            "CalculateLambda",
            runtime=_lambda.Runtime.PYTHON_3_12,
            handler="calculate_handler.handler",
            code=_lambda.Code.from_asset("lambda"),
            timeout=Duration.seconds(30),
            environment={
                "HISTORY_TABLE": history_table.table_name
            }
        )

        # Grant Lambda permissions to DynamoDB
        history_table.grant_read_write_data(calculate_lambda)

        # 🌐 API Gateway with Cognito Authorizer
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

        # 📤 Outputs for frontend configuration
        CfnOutput(self, "UserPoolId", value=user_pool.user_pool_id)
        CfnOutput(self, "UserPoolClientId", value=user_pool_client.user_pool_client_id)
        CfnOutput(self, "ApiEndpoint", value=api.url)
        CfnOutput(self, "Region", value=self.region)
