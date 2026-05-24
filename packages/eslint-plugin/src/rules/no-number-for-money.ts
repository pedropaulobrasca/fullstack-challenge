import { ESLintUtils, TSESTree, AST_NODE_TYPES } from "@typescript-eslint/utils";

const MONEY_LIKE =
  /^(amount|balance|bet|payout|price|wager|cents|money|fee|stake|win|loss)$|^(.+(?:Amount|Balance|Bet|Payout|Price|Wager|Cents|Money|Fee|Stake|Win|Loss))$/;

const createRule = ESLintUtils.RuleCreator(
  (name) => `https://example.com/rules/${name}`
);

export const noNumberForMoney = createRule({
  name: "no-number-for-money",
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow `number` type on money-like identifiers; use Money value object instead.",
    },
    messages: {
      banned:
        "Identifier '{{name}}' looks money-like; use the Money value object, not `number`.",
    },
    schema: [],
  },
  defaultOptions: [],
  create(context) {
    function isNumberType(node: TSESTree.TypeNode | undefined): boolean {
      if (!node) return false;
      if (node.type === AST_NODE_TYPES.TSNumberKeyword) return true;
      if (
        node.type === AST_NODE_TYPES.TSTypeReference &&
        node.typeName.type === AST_NODE_TYPES.Identifier &&
        node.typeName.name === "Number"
      ) {
        return true;
      }
      return false;
    }

    function check(
      name: string,
      typeAnnot: TSESTree.TSTypeAnnotation | undefined,
      reportNode: TSESTree.Node
    ): void {
      if (!typeAnnot) return;
      if (!MONEY_LIKE.test(name)) return;
      if (isNumberType(typeAnnot.typeAnnotation)) {
        context.report({
          node: reportNode,
          messageId: "banned",
          data: { name },
        });
      }
    }

    return {
      VariableDeclarator(node) {
        if (node.id.type === AST_NODE_TYPES.Identifier) {
          check(node.id.name, node.id.typeAnnotation, node.id);
        }
      },
      "FunctionDeclaration > Identifier, ArrowFunctionExpression > Identifier, FunctionExpression > Identifier"(
        node: TSESTree.Identifier
      ) {
        check(node.name, node.typeAnnotation, node);
      },
      TSPropertySignature(node) {
        if (node.key.type === AST_NODE_TYPES.Identifier) {
          check(node.key.name, node.typeAnnotation, node);
        }
      },
      PropertyDefinition(node) {
        if (node.key.type === AST_NODE_TYPES.Identifier) {
          check(node.key.name, node.typeAnnotation, node);
        }
      },
    };
  },
});
