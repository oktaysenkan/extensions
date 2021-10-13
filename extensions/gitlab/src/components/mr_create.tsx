import {
  showToast,
  ToastStyle,
  Form,
  Icon,
  FormTagPicker,
  FormTagPickerItem,
  popToRoot,
  ImageMask,
  ActionPanel,
  SubmitFormAction,
} from "@raycast/api";
import { Project, User, Label, Milestone, Branch } from "../gitlabapi";
import { gitlab } from "../common";
import { useState, useEffect } from "react";
import { projectIcon, toFormValues } from "../utils";
import { useCache } from "../cache";

interface MRFormValues {
  project_id: number;
  source_branch: string;
  target_branch: string;
  title: string;
  description: string;
  assignee_ids: number[];
  reviewer_ids: number[];
  labels: string[];
  milestone_id: number;
}

async function submit(values: MRFormValues) {
  try {
    if (values.title === "") {
      throw Error("Please enter a title");
    }
    if (values.source_branch === "") {
      throw Error("Please select a source branch");
    }
    const val = toFormValues(values);
    console.log(val);
    await gitlab.createMR(values.project_id, val);
    await showToast(ToastStyle.Success, "Merge Request created", "Merge Request creation successful");
    popToRoot();
  } catch (error: any) {
    await showToast(ToastStyle.Failure, "Error", error.message);
  }
}

export function MRCreateForm(props: { project?: Project | undefined; branch?: string | undefined }) {
  const [selectedProject, setSelectedProject] = useState<string | undefined>(
    props.project ? props.project.id.toString() : undefined
  );
  const {
    data: projects,
    error: errorProjects,
    isLoading: isLoadingProjects,
  } = useCache<Project[]>(
    "mrFormProjects",
    async (): Promise<Project[]> => {
      const pros = (await gitlab.getUserProjects({}, true)) || [];
      return pros;
    },
    {
      deps: [],
    }
  );
  const { projectinfo, errorProjectInfo, isLoadingProjectInfo } = useProject(selectedProject);
  const members = projectinfo?.members || [];
  const labels = projectinfo?.labels || [];
  const isLoading = isLoadingProjects || isLoadingProjectInfo;
  const error = errorProjects || errorProjectInfo;

  if (error) {
    showToast(ToastStyle.Failure, "Cannot create Merge Request", error);
  }

  let project: Project | undefined;
  if (selectedProject) {
    project = projects?.find((pro) => pro.id.toString() === selectedProject);
  }

  return (
    <Form
      onSubmit={submit}
      isLoading={isLoading}
      actions={
        <ActionPanel>
          <SubmitFormAction title="Create Merge Request" onSubmit={submit} />
        </ActionPanel>
      }
    >
      <ProjectDropdown projects={projects || []} setSelectedProject={setSelectedProject} value={selectedProject} />
      <SourceBranchDropdown project={project} info={projectinfo} value={props.branch} />
      <TargetBranchDropdown project={project} info={projectinfo} />
      <Form.TextField id="title" title="Title" placeholder="Enter title" />
      <Form.TextArea id="description" title="Description" placeholder="Enter description" />
      <FormTagPicker id="assignee_ids" title="Assignees" placeholder="Type or choose an assignee">
        {members.map((member) => (
          <FormTagPickerItem
            key={member.id.toString()}
            value={member.id.toString()}
            title={member.name || member.username}
            icon={{ source: member.avatar_url, mask: ImageMask.Circle }}
          />
        ))}
      </FormTagPicker>
      <FormTagPicker id="reviewer_ids" title="Reviewers" placeholder="Type or choose a reviewer">
        {members.map((member) => (
          <FormTagPickerItem
            key={member.id.toString()}
            value={member.id.toString()}
            title={member.name || member.username}
            icon={{ source: member.avatar_url }}
          />
        ))}
      </FormTagPicker>
      <FormTagPicker id="labels" title="Labels" placeholder="Type or choose an label">
        {labels.map((label) => (
          <FormTagPickerItem
            key={label.name}
            value={label.name}
            title={label.name}
            icon={{ source: Icon.Circle, tintColor: label.color }}
          />
        ))}
      </FormTagPicker>
      <Form.Dropdown id="milestone_id" title="Milestone">
        {projectinfo?.milestones?.map((m) => (
          <Form.Dropdown.Item key={m.id} value={m.id.toString()} title={m.title} />
        ))}
      </Form.Dropdown>
    </Form>
  );
}

function ProjectDropdown(props: {
  projects: Project[];
  setSelectedProject: React.Dispatch<React.SetStateAction<string | undefined>>;
  value?: string;
}) {
  const projects = props.projects;
  return (
    <Form.Dropdown
      id="project_id"
      title="Project"
      value={props.value}
      storeValue={true}
      onChange={(val: string) => {
        props.setSelectedProject(val);
      }}
    >
      {projects?.map((project) => (
        <ProjectDropdownItem key={project.id} project={project} />
      ))}
    </Form.Dropdown>
  );
}

function SourceBranchDropdown(props: {
  project?: Project | undefined;
  info?: ProjectInfoMR | undefined;
  value?: string | undefined;
}) {
  if (props.project && props.info) {
    const branches = props.info.branches.filter((b) => b.name !== "main");
    let value = undefined;
    if (props.value && branches.find((b) => b.name === props.value)) {
      value = props.value;
    } else {
      value = branches.length > 0 ? branches[0].name : "";
    }
    return (
      <Form.Dropdown id="source_branch" title="Source Branch" value={value}>
        <Form.Dropdown.Item key="_empty" value="" title="-" />
        {branches.map((branch) => (
          <Form.Dropdown.Item key={branch.name} value={branch.name} title={branch.name} />
        ))}
      </Form.Dropdown>
    );
  } else {
    return (
      <Form.Dropdown id="source_branch" title="Source Branch">
        <Form.Dropdown.Item key="_empty" value="" title="-" />
      </Form.Dropdown>
    );
  }
}

function TargetBranchDropdown(props: { project?: Project | undefined; info?: ProjectInfoMR | undefined }) {
  if (props.project && props.info) {
    const pro = props.project;
    const defaultBranch =
      pro.default_branch && pro.default_branch.length > 0 ? props.project.default_branch : undefined;
    console.log(defaultBranch);
    return (
      <Form.Dropdown id="target_branch" title="Target branch" value={defaultBranch}>
        {props.info?.branches.map((branch) => (
          <Form.Dropdown.Item key={branch.name} value={branch.name} title={branch.name} />
        ))}
      </Form.Dropdown>
    );
  } else {
    return <Form.Dropdown id="target_branch" title="Target branch" />;
  }
}

function ProjectDropdownItem(props: { project: Project }) {
  const pro = props.project;
  return <Form.Dropdown.Item value={pro.id.toString()} title={pro.name_with_namespace} icon={projectIcon(pro)} />;
}

export function useProject(query?: string): {
  projectinfo?: ProjectInfoMR;
  errorProjectInfo?: string;
  isLoadingProjectInfo: boolean;
} {
  const [projectinfo, setProjectInfo] = useState<ProjectInfoMR>();
  const [errorProjectInfo, setError] = useState<string>();
  const [isLoadingProjectInfo, setIsLoading] = useState<boolean>(false);

  let cancel = false;

  useEffect(() => {
    async function fetchData() {
      if (query === null || cancel) {
        return;
      }

      setIsLoading(true);
      setError(undefined);

      try {
        const proid = parseInt(query || "0");
        if (proid > 0) {
          console.log(`get projectinfo for project id '${proid}'`);
          const members = await gitlab.getProjectMember(proid);
          const labels = await gitlab.getProjectLabels(proid);
          const milestones = await gitlab.getProjectMilestones(proid);
          const branches = ((await gitlab.fetch(`projects/${proid}/repository/branches`, {}, true)) as Branch[]) || [];

          if (!cancel) {
            setProjectInfo({
              ...projectinfo,
              members: members,
              labels: labels,
              milestones: milestones,
              branches: branches,
            });
          }
        } else {
          console.log("no project selected");
        }
      } catch (e: any) {
        if (!cancel) {
          setError(e.toString());
        }
      } finally {
        if (!cancel) {
          setIsLoading(false);
        }
      }
    }

    fetchData();

    return () => {
      cancel = true;
    };
  }, [query]);

  return { projectinfo, errorProjectInfo, isLoadingProjectInfo };
}

interface ProjectInfoMR {
  members: User[];
  labels: Label[];
  milestones: Milestone[];
  branches: Branch[];
}
