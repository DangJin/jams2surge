import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  Action,
  ActionPanel,
  Detail,
  Form,
  Icon,
  showToast,
  Toast,
} from "@raycast/api";
import { useForm } from "@raycast/utils";
import { useState } from "react";

import { convertSubscriptionText } from "./subscription/convert";
import { fetchSubscription } from "./subscription/fetch";
import { generateSurgeProfile } from "./subscription/generate-profile";
import type { ConversionIssue, ConversionResult } from "./subscription/types";

interface FormValues {
  url: string;
}

interface SuccessfulConversion {
  profile: string;
  result: ConversionResult;
}

function validateUrl(value: string | undefined): string | undefined {
  if (!value) return "请输入订阅地址";
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:")
      return "仅支持 HTTP 或 HTTPS 地址";
  } catch {
    return "请输入有效的订阅地址";
  }
  return undefined;
}

function escapeMarkdown(value: string): string {
  return value.replace(/([\\`*_[\]<>])/g, "\\$1");
}

function issuesMarkdown(issues: ConversionIssue[]): string {
  if (issues.length === 0) return "";
  const lines = issues.map((issue) => {
    const name = issue.name
      ? ` ${escapeMarkdown(issue.name)}`
      : ` 第 ${issue.index} 项`;
    return `- **${issue.protocol.toUpperCase()}${name}**：${escapeMarkdown(issue.message)}`;
  });
  return `\n\n## 未转换项目\n\n${lines.join("\n")}`;
}

function timestamp(date: Date): string {
  const twoDigits = (value: number) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    twoDigits(date.getMonth() + 1),
    twoDigits(date.getDate()),
    "-",
    twoDigits(date.getHours()),
    twoDigits(date.getMinutes()),
    twoDigits(date.getSeconds()),
  ].join("");
}

async function saveProfile(profile: string): Promise<void> {
  const downloads = path.join(os.homedir(), "Downloads");
  const basename = `surge-profile-${timestamp(new Date())}`;

  for (let suffix = 1; ; suffix += 1) {
    const filename = `${basename}${suffix === 1 ? "" : `-${suffix}`}.conf`;
    const destination = path.join(downloads, filename);
    try {
      await fs.writeFile(destination, profile, {
        encoding: "utf8",
        flag: "wx",
      });
      await showToast({
        style: Toast.Style.Success,
        title: "配置已保存",
        message: destination,
      });
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
      await showToast({
        style: Toast.Style.Failure,
        title: "无法保存配置",
        message: "请检查下载目录权限",
      });
      return;
    }
  }
}

function ResultView({ profile, result }: SuccessfulConversion) {
  const unsupportedCount = result.issues.filter(
    (issue) => issue.kind === "unsupported",
  ).length;
  const invalidCount = result.issues.filter(
    (issue) => issue.kind === "invalid",
  ).length;
  const markdown = `# Surge Profile\n\n\`\`\`ini\n${profile}\`\`\`${issuesMarkdown(result.issues)}`;

  return (
    <Detail
      markdown={markdown}
      metadata={
        <Detail.Metadata>
          <Detail.Metadata.Label
            title="已转换"
            text={`${result.nodes.length} 个 Shadowsocks 节点`}
          />
          <Detail.Metadata.Label
            title="不兼容"
            text={`${unsupportedCount} 项`}
          />
          <Detail.Metadata.Label title="无效" text={`${invalidCount} 项`} />
        </Detail.Metadata>
      }
      actions={
        <ActionPanel>
          <Action.CopyToClipboard title="复制配置" content={profile} />
          <Action
            title="保存到下载目录"
            icon={Icon.Download}
            onAction={() => saveProfile(profile)}
          />
        </ActionPanel>
      }
    />
  );
}

export default function Command() {
  const [isLoading, setIsLoading] = useState(false);
  const [conversion, setConversion] = useState<SuccessfulConversion>();
  const { handleSubmit, itemProps } = useForm<FormValues>({
    async onSubmit(values) {
      setIsLoading(true);
      const toast = await showToast({
        style: Toast.Style.Animated,
        title: "正在下载并转换订阅",
      });
      try {
        const content = await fetchSubscription(values.url);
        const result = convertSubscriptionText(content);
        if (result.nodes.length === 0) {
          toast.style = Toast.Style.Failure;
          toast.title = "没有可转换的节点";
          toast.message =
            result.issues[0]?.message ?? "订阅中未发现兼容的 Shadowsocks 节点";
          return;
        }
        const profile = generateSurgeProfile(result.nodes);
        setConversion({ profile, result });
        toast.style = Toast.Style.Success;
        toast.title = `已转换 ${result.nodes.length} 个节点`;
        toast.message =
          result.issues.length > 0
            ? `${result.issues.length} 项未转换`
            : undefined;
      } catch (error) {
        toast.style = Toast.Style.Failure;
        toast.title = "转换失败";
        toast.message = error instanceof Error ? error.message : "发生未知错误";
      } finally {
        setIsLoading(false);
      }
    },
    validation: {
      url: (value) => validateUrl(value),
    },
  });

  if (conversion) return <ResultView {...conversion} />;

  return (
    <Form
      isLoading={isLoading}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="转换为 Surge Profile"
            icon={Icon.ArrowRight}
            onSubmit={handleSubmit}
          />
        </ActionPanel>
      }
    >
      <Form.TextField
        title="订阅地址"
        placeholder="https://example.com/subscription"
        autoFocus
        {...itemProps.url}
      />
      <Form.Description text="支持 Shadowsocks；VLESS 将被识别并报告，但 Surge 无法原生使用。" />
    </Form>
  );
}
