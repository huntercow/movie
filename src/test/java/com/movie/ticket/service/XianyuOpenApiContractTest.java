package com.movie.ticket.service;

import org.junit.jupiter.api.Test;
import org.yaml.snakeyaml.Yaml;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class XianyuOpenApiContractTest {

    @Test
    void openApiExposesOnlyTheCurrentPaymentFlowPaths() throws Exception {
        Map<String, Object> document = loadOpenApi();
        Map<String, Object> paths = map(document.get("paths"));

        assertThat(paths)
                .doesNotContainKey("/api/xianyu/orders/paid")
                .containsKeys(
                        "/api/xianyu/orders/waiting-payment",
                        "/api/xianyu/orders/waiting-payment/{chatId}",
                        "/api/xianyu/orders/{platformOrderId}/adjusted",
                        "/api/xianyu/orders/{platformOrderId}/paid-verification",
                        "/api/xianyu/orders/{platformOrderId}/verification-failures"
                );

        assertRequestSchema(paths, "/api/xianyu/orders/waiting-payment", "XianyuWaitingPaymentRequest");
        assertRequestSchema(paths, "/api/xianyu/orders/{platformOrderId}/adjusted", "XianyuAdjustedOrderRequest");
        assertRequestSchema(paths, "/api/xianyu/orders/{platformOrderId}/paid-verification", "XianyuPaidVerificationRequest");
        assertRequestSchema(paths, "/api/xianyu/orders/{platformOrderId}/verification-failures", "XianyuVerificationFailureRequest");
    }

    @Test
    void openApiUsesStrictIntegerCentsAndClosedEvidenceEnums() throws Exception {
        Map<String, Object> schemas = schemas(loadOpenApi());

        assertThat(schemas).doesNotContainKey("XianyuPaidOrderRequest");
        assertThat(schemas).containsKeys(
                "XianyuWaitingPaymentRequest",
                "XianyuWaitingPaymentResponse",
                "XianyuAdjustedOrderRequest",
                "XianyuPaidVerificationRequest",
                "XianyuVerificationFailureRequest",
                "XianyuAmountVerificationSource",
                "XianyuVerificationFailureCode"
        );

        assertIntegerCents(schemas, "XianyuAdjustedOrderRequest", "adjustedAmountCents");
        assertIntegerCents(schemas, "XianyuPaidVerificationRequest", "paidAmountCents");
        assertIntegerCents(schemas, "XianyuPaidVerificationRequest", "itemTotalCents");
        assertIntegerCents(schemas, "XianyuPaidVerificationRequest", "postFeeCents");
        assertIntegerCents(schemas, "XianyuWaitingPaymentResponse", "totalPriceCents");

        Map<String, Object> waitingProperties = properties(schemas, "XianyuWaitingPaymentRequest");
        Map<String, Object> adjustedProperties = properties(schemas, "XianyuAdjustedOrderRequest");
        Map<String, Object> paidProperties = properties(schemas, "XianyuPaidVerificationRequest");
        Map<String, Object> failureProperties = properties(schemas, "XianyuVerificationFailureRequest");
        assertThat(waitingProperties).doesNotContainKeys("userId", "rawPayload", "paidAmount");
        assertThat(adjustedProperties).doesNotContainKeys("rawPayload", "paidAmount");
        assertThat(paidProperties).doesNotContainKeys("rawPayload", "paidAmount");
        assertThat(failureProperties).doesNotContainKey("rawPayload");

        assertThat(map(paidProperties.get("source")))
                .containsEntry("$ref", "#/components/schemas/XianyuAmountVerificationSource");
        assertThat(map(failureProperties.get("code")))
                .containsEntry("$ref", "#/components/schemas/XianyuVerificationFailureCode");
        assertThat(map(schemas.get("XianyuAmountVerificationSource")).get("enum"))
                .isEqualTo(List.of("XIANYU_ORDER_DETAIL_PRICE_INFO_AMOUNT"));
        assertThat(map(schemas.get("XianyuVerificationFailureCode")).get("enum"))
                .isEqualTo(List.of(
                        "ADJUST_PRICE_REJECTED",
                        "ORDER_DETAIL_REQUEST_FAILED",
                        "ORDER_DETAIL_PROTOCOL_ERROR",
                        "ORDER_ID_MISMATCH",
                        "AMOUNT_MISMATCH",
                        "NON_ZERO_POST_FEE",
                        "MISSING_ADJUSTMENT"
                ));
    }

    private Map<String, Object> loadOpenApi() throws Exception {
        String yaml = Files.readString(Path.of("docs/apifox-openapi.yaml"));
        return map(new Yaml().load(yaml));
    }

    private Map<String, Object> schemas(Map<String, Object> document) {
        return map(map(document.get("components")).get("schemas"));
    }

    private void assertRequestSchema(Map<String, Object> paths, String path, String schemaName) {
        Map<String, Object> post = map(map(paths.get(path)).get("post"));
        Map<String, Object> requestBody = map(post.get("requestBody"));
        Map<String, Object> content = map(requestBody.get("content"));
        Map<String, Object> applicationJson = map(content.get("application/json"));
        assertThat(map(applicationJson.get("schema")))
                .containsEntry("$ref", "#/components/schemas/" + schemaName);
    }

    private void assertIntegerCents(
            Map<String, Object> schemas,
            String schemaName,
            String propertyName
    ) {
        assertThat(map(properties(schemas, schemaName).get(propertyName)))
                .containsEntry("type", "integer")
                .containsEntry("format", "int64");
    }

    private Map<String, Object> properties(Map<String, Object> schemas, String schemaName) {
        return map(map(schemas.get(schemaName)).get("properties"));
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> map(Object value) {
        assertThat(value).isInstanceOf(Map.class);
        return (Map<String, Object>) value;
    }
}
